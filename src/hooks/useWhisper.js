import { useCallback, useEffect, useRef, useState } from 'react'
import { pipeline, env } from '@huggingface/transformers'

const MODEL_ID = 'Xenova/whisper-base.en' // English-only, ~80MB, cached offline
const SAMPLE_RATE = 16000
const CHUNK_SAMPLES = 4096
const TICK_MS = 1500 // transcription cadence while listening
const MIN_AUDIO_S = 2 // don't transcribe before this much audio exists
const TAIL_KEEP_S = 0.35 // words ending this close to the live edge stay interim
const CONTEXT_S = 0.5 // re-check window behind the finalized frontier

// Skip heavy node-only backends if the bundler pulls them in.
env.allowLocalModels = false

let asrPromise = null
let progressSink = null

function loadASR() {
  if (!asrPromise) {
    const report = (p) => {
      if (p?.status === 'progress' && p.total) {
        progressSink?.((p.loaded / p.total) * 100)
      }
    }
    const tryLoad = (device, dtype) =>
      pipeline('automatic-speech-recognition', MODEL_ID, {
        device,
        dtype,
        progress_callback: report,
      })

    asrPromise = navigator.gpu
      ? tryLoad('webgpu', 'fp32').catch(() => tryLoad('wasm', 'q8'))
      : tryLoad('wasm', 'q8')
    asrPromise.catch(() => {
      asrPromise = null
    })
  }
  return asrPromise
}

// Linear-resample fallback for browsers that ignore the AudioContext
// sample-rate option (e.g. older Safari).
function resampleTo16k(input, inputRate) {
  if (inputRate === SAMPLE_RATE || !inputRate) return input
  const ratio = inputRate / SAMPLE_RATE
  const len = Math.floor(input.length / ratio)
  const out = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const pos = i * ratio
    const j = Math.floor(pos)
    const frac = pos - j
    const a = input[j]
    const b = input[Math.min(j + 1, input.length - 1)]
    out[i] = a + (b - a) * frac
  }
  return out
}

/**
 * Live speech-to-text powered by an in-browser Whisper model.
 * Same interface as the old Vosk hook: transcript grows word by word while
 * `listening`; `interim` holds words near the live edge.
 */
export function useWhisper() {
  const [supported] = useState(
    () => typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
  )
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(null)
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState(null)

  const streamRef = useRef(null)
  const ctxRef = useRef(null)
  const procRef = useRef(null)
  const timerRef = useRef(null)
  const busyRef = useRef(false)
  const captureRateRef = useRef(SAMPLE_RATE)

  // Growing audio buffer, kept as fixed-size chunks.
  const chunksRef = useRef([])
  const totalRef = useRef(0)
  const frontierRef = useRef(0) // seconds of already-emitted audio

  const sliceAudio = useCallback((fromS, toS) => {
    const from = Math.max(0, Math.floor(fromS * SAMPLE_RATE))
    const to = Math.min(totalRef.current, Math.floor(toS * SAMPLE_RATE))
    const out = new Float32Array(Math.max(0, to - from))
    let offset = 0
    for (
      let i = Math.floor(from / CHUNK_SAMPLES);
      i < chunksRef.current.length && offset < out.length;
      i++
    ) {
      const cStart = i * CHUNK_SAMPLES
      const lo = Math.max(from - cStart, 0)
      const hi = Math.min(CHUNK_SAMPLES, to - cStart)
      if (hi > lo) {
        out.set(chunksRef.current[i].subarray(lo, hi), offset)
        offset += hi - lo
      }
    }
    return out
  }, [])

  const transcribe = useCallback(
    async ({ final = false } = {}) => {
      if (busyRef.current) return
      const asr = await loadASR()
      if (!chunksRef.current.length) return

      const dur = totalRef.current / SAMPLE_RATE
      const frontier = frontierRef.current
      const tailKeep = final ? 0 : TAIL_KEEP_S
      const fromS = Math.max(0, frontier - CONTEXT_S)

      if (!final && (dur < MIN_AUDIO_S || dur - frontier < 0.8)) return

      busyRef.current = true
      try {
        const audio = sliceAudio(fromS, dur)
        if (audio.length < SAMPLE_RATE * 0.3) return

        const out = await asr(audio, {
          return_timestamps: 'word',
          chunk_length_s: 30,
          stride_length_s: 5,
        })

        const words = (out.chunks || []).map((c) => ({
          text: (c.text || '').trim(),
          start: fromS + (c.timestamp?.[0] ?? 0),
          end: fromS + (c.timestamp?.[1] ?? Number.MAX_SAFE_INTEGER),
        }))

        const finals = []
        const parts = []
        let newFrontier = frontier
        for (const w of words) {
          if (!w.text) continue
          if (w.end <= frontier) continue // fully old
          // Boundary duplicate: word straddles the frontier and whisper
          // re-reported it with jittered timestamps.
          const startedBefore = w.start < frontier - 0.05
          if (startedBefore && w.end <= frontier + 0.25) continue
          if (w.end <= dur - tailKeep) {
            finals.push(w.text)
            newFrontier = Math.max(newFrontier, w.end)
          } else {
            parts.push(w.text)
          }
        }

        frontierRef.current = newFrontier
        if (finals.length) {
          setTranscript((prev) =>
            prev ? `${prev} ${finals.join(' ')}` : finals.join(' '),
          )
        }
        setInterim(parts.join(' '))
      } catch (e) {
        setError(e?.message || 'Transcription failed')
      } finally {
        busyRef.current = false
      }
    },
    [sliceAudio],
  )

  const start = useCallback(async () => {
    if (listening) return
    setError(null)
    setTranscript('')
    setInterim('')
    frontierRef.current = 0
    try {
      setLoading(true)
      progressSink = setProgress
      await loadASR()
      setLoading(false)
      setProgress(null)

      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      })
      streamRef.current = stream

      const ctx = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: SAMPLE_RATE,
      })
      if (ctx.state === 'suspended') await ctx.resume()
      ctxRef.current = ctx
      captureRateRef.current = ctx.sampleRate

      const source = ctx.createMediaStreamSource(stream)
      const proc = ctx.createScriptProcessor(CHUNK_SAMPLES, 1, 1)
      proc.onaudioprocess = (e) => {
        const input = e.inputBuffer.getChannelData(0)
        const data = resampleTo16k(input, captureRateRef.current)
        chunksRef.current.push(new Float32Array(data))
        totalRef.current += data.length
      }
      const sink = ctx.createGain()
      sink.gain.value = 0
      source.connect(proc)
      proc.connect(sink)
      sink.connect(ctx.destination)
      procRef.current = proc

      timerRef.current = setInterval(() => transcribe(), TICK_MS)
      setListening(true)
    } catch (e) {
      setLoading(false)
      setError(e?.message || 'Mic access failed')
    }
  }, [listening, transcribe])

  const stop = useCallback(() => {
    const flush = transcribe({ final: true }).catch(() => {})
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = null
    procRef.current?.disconnect()
    procRef.current = null
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {})
      ctxRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setListening(false)
    return flush
  }, [transcribe])

  const reset = useCallback(() => {
    setTranscript('')
    setInterim('')
    setError(null)
  }, [])

  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current)
      procRef.current?.disconnect()
      if (ctxRef.current) ctxRef.current.close().catch(() => {})
      if (streamRef.current)
        streamRef.current.getTracks().forEach((t) => t.stop())
    },
    [],
  )

  return {
    supported,
    loading,
    progress,
    listening,
    transcript,
    interim,
    error,
    start,
    stop,
    reset,
  }
}
