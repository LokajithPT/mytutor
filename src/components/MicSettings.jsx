import { useCallback, useEffect, useRef, useState } from 'react'

export default function MicSettings({ currentId, onSelect, onlineGrammar, onToggleGrammar }) {
  const [devices, setDevices] = useState([])
  const [needsPermission, setNeedsPermission] = useState(false)
  const [testing, setTesting] = useState(false)
  const [level, setLevel] = useState(0)
  const [error, setError] = useState(null)

  const streamRef = useRef(null)
  const ctxRef = useRef(null)
  const rafRef = useRef(null)
  const silentFramesRef = useRef(0)

  const refresh = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      const mics = list.filter((d) => d.kind === 'audioinput')
      setDevices(mics)
      // Labels are empty until the user has granted mic permission once.
      setNeedsPermission(mics.length > 0 && mics.every((d) => !d.label))
    } catch (e) {
      setError(e?.message || 'Could not list devices')
    }
  }, [])

  useEffect(() => {
    refresh()
    navigator.mediaDevices.addEventListener('devicechange', refresh)
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', refresh)
      stopTest()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh])

  function stopTest() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {})
      ctxRef.current = null
    }
    silentFramesRef.current = 0
    setTesting(false)
    setLevel(0)
  }

  async function enablePermissions() {
    setError(null)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true })
      s.getTracks().forEach((t) => t.stop())
      await refresh()
    } catch {
      setError('Microphone permission denied.')
    }
  }

  async function startTest() {
    setError(null)
    silentFramesRef.current = 0
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: currentId ? { deviceId: { exact: currentId } } : true,
      })
      streamRef.current = s

      const ctx = new (window.AudioContext || window.webkitAudioContext)()
      if (ctx.state === 'suspended') await ctx.resume()
      ctxRef.current = ctx

      const source = ctx.createMediaStreamSource(s)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)

      const buf = new Float32Array(analyser.fftSize)
      const loop = () => {
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
        const rms = Math.sqrt(sum / buf.length)

        setLevel((prev) => {
          const next = Math.max(rms * 4, prev * 0.82) // fast rise, slow decay
          if (next < 0.02) silentFramesRef.current += 1
          else silentFramesRef.current = 0
          return next
        })
        rafRef.current = requestAnimationFrame(loop)
      }
      setTesting(true)
      loop()
    } catch (e) {
      setError(e?.message || 'Could not open microphone')
    }
  }

  const pct = Math.min(100, Math.round(level * 100))
  const noSignal = testing && silentFramesRef.current > 120

  return (
    <section className="mic-panel">
      <h2>Microphone</h2>

      {error && <p className="panel-error">{error}</p>}

      {needsPermission ? (
        <div className="perm-row">
          <p>Allow mic access once to list your devices by name.</p>
          <button className="clear" onClick={enablePermissions}>
            Allow &amp; list microphones
          </button>
        </div>
      ) : (
        <select
          className="mic-select"
          value={currentId}
          onChange={(e) => onSelect(e.target.value)}
        >
          <option value="">Default microphone</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || 'Microphone'}
            </option>
          ))}
        </select>
      )}

      <div className="meter-row">
        <button
          className="clear"
          onClick={testing ? stopTest : startTest}
        >
          {testing ? 'Stop test' : 'Test microphone'}
        </button>
        <div className="meter" aria-hidden="true">
          <div className="meter-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="meter-num">{pct}%</span>
      </div>

      {noSignal && (
        <p className="panel-hint">
          No signal detected — make some noise, or pick a different device.
        </p>
      )}
      {testing && !noSignal && (
        <p className="panel-hint">Speak normally — aim for the yellow zone.</p>
      )}

      <p className="panel-note">
        Changes apply the next time you click the mic.
      </p>

      <div className="grammar-toggle">
        <label>
          <input type="checkbox" checked={onlineGrammar} onChange={onToggleGrammar} />
          <span>
            Online grammar (LanguageTool)
            <small>Off by default — keeps everything on your machine.</small>
          </span>
        </label>
      </div>
    </section>
  )
}
