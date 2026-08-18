import { useCallback, useEffect, useRef, useState } from 'react'
import { createModel } from 'vosk-browser'
import { getCachedModelUrl } from '../lib/modelCache'

const MODEL_URL = '/vosk-models/vosk-model-small-en-us-0.15.tar.gz'

export function useVosk({ modelUrl = MODEL_URL } = {}) {
  const [supported] = useState(
    typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
  )
  const [loading, setLoading] = useState(false)
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)

  const modelRef = useRef(null)
  const recognizerRef = useRef(null)
  const streamRef = useRef(null)
  const audioCtxRef = useRef(null)
  const procRef = useRef(null)

  const ensureModel = useCallback(async () => {
    if (modelRef.current) return modelRef.current
    setLoading(true)
    setError(null)
    try {
      const url = await getCachedModelUrl(modelUrl)
      const model = await createModel(url)
      modelRef.current = model
      setReady(true)
      return model
    } catch (e) {
      setError(e?.message || 'Failed to load model')
      throw e
    } finally {
      setLoading(false)
    }
  }, [modelUrl])

  const start = useCallback(async () => {
    if (listening) return
    setError(null)
    try {
      const model = await ensureModel()
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      })
      streamRef.current = stream

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      if (audioCtx.state === 'suspended') await audioCtx.resume()
      audioCtxRef.current = audioCtx

      const recognizer = new model.KaldiRecognizer(16000)
      recognizerRef.current = recognizer
      recognizer.on('result', (msg) => {
        const text = msg.result?.text?.trim()
        if (text) {
          setTranscript((prev) => (prev ? prev + ' ' : '') + text)
          setInterim('')
        }
      })
      recognizer.on('partialresult', (msg) => {
        setInterim(msg.result?.partial || '')
      })
      recognizer.on('error', (msg) => setError(msg.error))

      const source = audioCtx.createMediaStreamSource(stream)
      const processor = audioCtx.createScriptProcessor(4096, 1, 1)
      processor.onaudioprocess = (e) => {
        try {
          recognizer.acceptWaveform(e.inputBuffer)
        } catch {
          /* ignore */
        }
      }
      const sink = audioCtx.createGain()
      sink.gain.value = 0
      source.connect(processor)
      processor.connect(sink)
      sink.connect(audioCtx.destination)
      procRef.current = processor

      setListening(true)
    } catch (e) {
      setError(e?.message || 'Mic access failed')
      setListening(false)
    }
  }, [listening, ensureModel])

  const stop = useCallback(() => {
    if (!listening) return
    try {
      recognizerRef.current?.remove()
    } catch {
      /* ignore */
    }
    recognizerRef.current = null
    procRef.current?.disconnect()
    procRef.current = null
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    setListening(false)
  }, [listening])

  const reset = useCallback(() => {
    setTranscript('')
    setInterim('')
    setError(null)
  }, [])

  useEffect(() => {
    return () => {
      try {
        recognizerRef.current?.remove()
      } catch {
        /* ignore */
      }
      if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {})
      if (streamRef.current)
        streamRef.current.getTracks().forEach((t) => t.stop())
      modelRef.current?.terminate()
      modelRef.current = null
    }
  }, [])

  return {
    supported,
    loading,
    ready,
    listening,
    transcript,
    interim,
    error,
    start,
    stop,
    reset,
  }
}
