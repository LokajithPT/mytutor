import { useCallback, useEffect, useRef, useState } from 'react'

const SERVER_URL = '/api/stt'
const SAMPLE_RATE = 16000
const CHUNK_SAMPLES = 4096
const TICK_MS = 1500 // transcription cadence while listening
const MIN_AUDIO_S = 2 // don't transcribe before this much audio exists
const TAIL_KEEP_S = 0.35 // words ending this close to the live edge stay interim
const CONTEXT_S = 0.5 // re-check window behind the finalized frontier
const HEALTH_POLL_MS = 10000
// RMS below this is treated as room tone and never sent — feeding silence to
// Whisper makes it hallucinate stock phrases. Generous hangover keeps word
// tails from being clipped at speech boundaries.
const SPEECH_RMS = 0.0025
const HANGOVER_CHUNKS = 8 // ~2s of trailing audio kept after speech stops

/**
 * Live speech-to-text backed by the local faster-whisper service
 * (see server/main.py). Audio is captured at 16kHz, chunked, and posted to
 * /api/stt/transcribe; word timestamps come back already shifted onto the
 * client's audio timeline, where a frontier-based merge turns them into
 * finalized transcript + interim tail.
 */

function encodePcm16(float32) {
  const buffer = new ArrayBuffer(float32.length * 2)
  const view = new DataView(buffer)
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]))
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return buffer
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

export function useWhisper() {
  const [supported] = useState(
    () => typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
  )
  const [serverUp, setServerUp] = useState('unknown') // unknown | up | down
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
  const serverUpRef = useRef('unknown')
  const hangoverRef = useRef(0)

  // Growing audio buffer, kept as fixed-size chunks.
  const chunksRef = useRef([])
  const totalRef = useRef(0)
  const frontierRef = useRef(0) // seconds of already-emitted audio

  const resetBuffer = useCallback(() => {
    chunksRef.current = []
    totalRef.current = 0
    frontierRef.current = 0
    hangoverRef.current = 0
    busyRef.current = false
  }, [])

  const pushChunk = useCallback((data) => {
    chunksRef.current.push(new Float32Array(data))
    totalRef.current += data.length
  }, [])

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

  const probeHealth = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/health`, {
        signal: AbortSignal.timeout(3000),
      })
      const ok = res.ok && (await res.json())?.ready
      serverUpRef.current = ok ? 'up' : 'down'
      setServerUp(serverUpRef.current)
    } catch {
      serverUpRef.current = 'down'
      setServerUp('down')
    }
  }, [])

  // Probe now, then keep polling so the UI recovers once the user starts
  // the server (no reload needed).
  useEffect(() => {
    probeHealth()
    const id = setInterval(() => {
      if (serverUpRef.current !== 'up') probeHealth()
    }, HEALTH_POLL_MS)
    return () => clearInterval(id)
  }, [probeHealth])

  const transcribe = useCallback(
    async ({ final = false } = {}) => {
      if (busyRef.current) return
      if (serverUpRef.current !== 'up') {
        await probeHealth()
        if (serverUpRef.current !== 'up') throw new Error('Speech server offline')
      }

      const dur = totalRef.current / SAMPLE_RATE
      const frontier = frontierRef.current
      const tailKeep = final ? 0 : TAIL_KEEP_S
      const fromS = Math.max(0, frontier - CONTEXT_S)

      if (!final && (dur < MIN_AUDIO_S || dur - frontier < 0.8)) return

      const audio = sliceAudio(fromS, dur)
      if (audio.length < SAMPLE_RATE * 0.3) return

      busyRef.current = true
      try {
        const res = await fetch(
          `${SERVER_URL}/transcribe?offset=${fromS.toFixed(3)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: encodePcm16(audio),
          },
        )
        if (!res.ok) throw new Error(`STT server error ${res.status}`)
        const data = await res.json()

        // Word times arrive absolute (offset applied server-side).
        const words = (data.words || []).map((w) => ({
          text: (w.text || '').trim(),
          start: w.start ?? 0,
          end: w.end ?? Number.MAX_SAFE_INTEGER,
        }))

        const finals = []
        const parts = []
        let newFrontier = frontier
        for (const w of words) {
          if (!w.text) continue
          if (w.end <= frontier) continue // fully old
          // Boundary duplicate: word straddles the frontier and was
          // re-reported because chunks overlap by CONTEXT_S.
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
        setError(null)
      } finally {
        busyRef.current = false
      }
    },
    [sliceAudio, probeHealth, resetBuffer, pushChunk],
  )

  const start = useCallback(
    async ({ deviceId } = {}) => {
      if (listening) return
      setError(null)
      setTranscript('')
      setInterim('')
      // Fresh session: wipe the previous recording's audio too, otherwise
      // the first tick re-transcribes everything from old sessions and
      // stale words come flooding back.
      resetBuffer()

      if (serverUpRef.current !== 'up') {
        await probeHealth()
      }
      if (serverUpRef.current !== 'up') {
        setError(
          'Speech server is not running. Start it with: python server/main.py',
        )
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            channelCount: 1,
            ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
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
          const raw = e.inputBuffer.getChannelData(0)
          const data = resampleTo16k(raw, captureRateRef.current)

          let sum = 0
          for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
          const rms = Math.sqrt(sum / data.length)

          if (rms >= SPEECH_RMS) {
            hangoverRef.current = HANGOVER_CHUNKS
            pushChunk(data)
          } else if (hangoverRef.current > 0) {
            hangoverRef.current--
            pushChunk(data)
          }
          // else: dead air — dropped, timeline stays consistent because
          // totalRef only counts what we actually keep.
        }
        const sink = ctx.createGain()
        sink.gain.value = 0
        source.connect(proc)
        proc.connect(sink)
        sink.connect(ctx.destination)
        procRef.current = proc

        timerRef.current = setInterval(() => {
          transcribe().catch((err) => setError(err?.message || String(err)))
        }, TICK_MS)
        setListening(true)
      } catch (e) {
        setError(e?.message || 'Mic access failed')
      }
    },
    [listening, transcribe, probeHealth, resetBuffer],
  )

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
    serverUp,
    listening,
    transcript,
    interim,
    error,
    start,
    stop,
    reset,
  }
}
