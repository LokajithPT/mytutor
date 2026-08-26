import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWhisper } from './hooks/useWhisper'
import { checkGrammar } from './lib/grammar'
import { fetchTips } from './lib/tips'
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
  const { supported, serverUp, listening, transcript, interim, error } = asr

  const selectMic = useCallback((id) => {
    setMicId(id)
    if (id) localStorage.setItem(MIC_STORAGE_KEY, id)
    else localStorage.removeItem(MIC_STORAGE_KEY)
  }, [])

  // Every capture start goes through here so the chosen device is used.
  // New session = old coaching is obsolete.
  const startWithDevice = useCallback(
    (opts) => {
      setTips([])
      setTipsState('idle')
      return asr.start({ ...opts, deviceId: micId || undefined })
    },
    [asr, micId],
  )

  const [matches, setMatches] = useState([])
  const [grammarState, setGrammarState] = useState('idle') // idle | checking | error
  const [copied, setCopied] = useState(false)
  const [tips, setTips] = useState([])
  const [tipsLlmOk, setTipsLlmOk] = useState(true)
  const [tipsState, setTipsState] = useState('idle') // idle | loading | done | error
  const abortRef = useRef(null)

  const reviewSpeech = useCallback(async () => {
    if (!transcript.trim()) return
    setTipsState('loading')
    try {
      const { tips: found, llmOk } = await fetchTips(transcript)
      setTips(found)
      setTipsLlmOk(llmOk)
      setTipsState('done')
    } catch {
      setTips([])
      setTipsState('error')
    }
  }, [transcript])

  // Tips describe a specific transcript — drop them whenever the words do.
  const resetSession = useCallback(() => {
    asr.reset()
    setTips([])
    setTipsState('idle')
  }, [asr])

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

      {serverUp === 'down' && (
        <div className="server-banner">
          <strong>Speech server is not running.</strong>
          <span>In a second terminal:</span>
          <code>cd server &amp;&amp; uv run main.py</code>
          <code># or: pip install -r server/requirements.txt &amp;&amp; python main.py</code>
        </div>
      )}

      {mode === 'dictate' ? (
        <>
          <MicButton
            listening={listening}
            disabled={serverUp === 'down'}
            onToggle={toggle}
          />

          <p className="status">
            {error
              ? `Error: ${error}`
              : listening
                ? 'Listening… click to stop'
                : serverUp === 'down'
                  ? 'Waiting for speech server…'
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
              className="review"
              onClick={reviewSpeech}
              disabled={!transcript || listening || tipsState === 'loading'}
            >
              {tipsState === 'loading' ? 'Analyzing…' : 'Review my speech'}
            </button>
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
            <button className="clear" onClick={resetSession} disabled={listening}>
              Clear
            </button>
          </div>

          {tipsState === 'error' && (
            <p className="grammar-note error">
              Review failed — is the speech server running?
            </p>
          )}

          {tipsState === 'done' && (
            <section className="tips">
              <h2>Better words</h2>
              {tips.length === 0 ? (
                <p className="tips-empty">
                  {tipsLlmOk
                    ? 'Nothing to improve — nice one!'
                    : 'Local LLM not reachable. Start llama-server, then retry.'}
                </p>
              ) : (
                <ul>
                  {tips.map((t, i) => (
                    <li key={i}>
                      <span className="tip-said">“{t.phrase}”</span>
                      <span className="tip-arrow">→</span>
                      <span className="tip-alts">{t.alternatives.join(', ')}</span>
                      {t.reason && <span className="tip-reason"> — {t.reason}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      ) : (
        <ReadingTest {...asr} start={startWithDevice} />
      )}
    </main>
  )
}
