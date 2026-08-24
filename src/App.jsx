import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWhisper } from './hooks/useWhisper'
import { checkGrammar } from './lib/grammar'
import MicButton from './components/MicButton'
import MicSettings from './components/MicSettings'
import HighlightedText from './components/HighlightedText'
import ReadingTest from './components/ReadingTest'

const MIC_STORAGE_KEY = 'mytutor.micId'

export default function App() {
  const [mode, setMode] = useState('dictate') // dictate | read
  const [showMicPanel, setShowMicPanel] = useState(false)
  const [micId, setMicId] = useState(
    () => localStorage.getItem(MIC_STORAGE_KEY) || '',
  )
  const asr = useWhisper()
  const { supported, loading, progress, listening, transcript, interim, error } =
    asr

  const selectMic = useCallback((id) => {
    setMicId(id)
    if (id) localStorage.setItem(MIC_STORAGE_KEY, id)
    else localStorage.removeItem(MIC_STORAGE_KEY)
  }, [])

  // Every capture start goes through here so the chosen device is used.
  const startWithDevice = useCallback(
    (opts) => asr.start({ ...opts, deviceId: micId || undefined }),
    [asr, micId],
  )

  const [matches, setMatches] = useState([])
  const [grammarState, setGrammarState] = useState('idle') // idle | checking | error
  const [copied, setCopied] = useState(false)
  const abortRef = useRef(null)

  // Grammar check runs on the finalized transcript (debounced), in Dictate
  // mode only. The original text is never changed — we collect spans to
  // highlight, ignoring punctuation/casing categories.
  useEffect(() => {
    if (mode !== 'dictate' || !transcript.trim()) {
      setMatches([])
      setGrammarState('idle')
      return
    }
    const handle = setTimeout(async () => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setGrammarState('checking')
      try {
        const found = await checkGrammar(transcript, { signal: ctrl.signal })
        if (!ctrl.signal.aborted) {
          setMatches(found)
          setGrammarState('idle')
        }
      } catch (e) {
        if (e.name !== 'AbortError' && !ctrl.signal.aborted) {
          setGrammarState('error')
        }
      }
    }, 700)
    return () => clearTimeout(handle)
  }, [transcript, mode])

  const toggle = () => (listening ? asr.stop() : startWithDevice())

  const issueList = useMemo(
    () =>
      matches
        .map((m) => ({
          ...m,
          phrase: transcript.slice(m.offset, m.offset + m.length),
        }))
        .filter((m) => m.phrase),
    [matches, transcript],
  )

  if (!supported) {
    return (
      <main className="app">
        <div className="card unsupported">
          <h1>Not supported</h1>
          <p>
            This browser doesn't support microphone capture. Please use a
            recent Chrome, Edge, or Firefox.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="app">
      <header className="topbar">
        <h1>mytutor</h1>
        <div className="controls">
          <nav className="mode-toggle" aria-label="Mode">
            <button
              className={`mode-btn ${mode === 'dictate' ? 'active' : ''}`}
              onClick={() => setMode('dictate')}
            >
              Dictate
            </button>
            <button
              className={`mode-btn ${mode === 'read' ? 'active' : ''}`}
              onClick={() => setMode('read')}
            >
              Reading Test
            </button>
          </nav>
          <button
            className="settings-btn"
            aria-label="Microphone settings"
            title="Microphone settings"
            onClick={() => setShowMicPanel((v) => !v)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
            </svg>
          </button>
        </div>
      </header>

      {showMicPanel && (
        <MicSettings
          currentId={micId}
          onSelect={selectMic}
        />
      )}

      {mode === 'dictate' ? (
        <>
          <MicButton listening={listening} disabled={loading} onToggle={toggle} />

          <p className="status">
            {loading
              ? `Loading Whisper model (first time only)…${
                  progress != null ? ` ${Math.round(progress)}%` : ''
                }`
              : error
                ? `Error: ${error}`
                : listening
                  ? 'Listening… click to stop'
                  : 'Click the mic and start talking'}
          </p>

          <section className="transcript" aria-live="polite">
            <span className="final">
              <HighlightedText text={transcript} matches={matches} />
            </span>
            <span className="interim">{interim}</span>
            {listening && <span className="caret" />}
          </section>

          {grammarState === 'checking' && (
            <p className="grammar-note">Checking grammar…</p>
          )}
          {grammarState === 'error' && (
            <p className="grammar-note error">
              Grammar check unavailable (needs internet).
            </p>
          )}

          {issueList.length > 0 && (
            <section className="issues">
              <h2>{issueList.length} thing(s) to look at</h2>
              <ul>
                {issueList.map((m, i) => (
                  <li key={i}>
                    <span className="issue-phrase">“{m.phrase}”</span> —{' '}
                    {m.message}
                    {m.suggestions?.length > 0 && (
                      <span className="issue-suggestion">
                        {' '}
                        (try: {m.suggestions.join(', ')})
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="actions">
            <button
              className="clear"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(transcript)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                } catch {
                  /* clipboard unavailable */
                }
              }}
              disabled={!transcript || listening}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <button className="clear" onClick={asr.reset} disabled={listening}>
              Clear
            </button>
          </div>
        </>
      ) : (
        <ReadingTest {...asr} start={startWithDevice} />
      )}
    </main>
  )
}
