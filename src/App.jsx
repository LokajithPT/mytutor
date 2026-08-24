import { useEffect, useMemo, useRef, useState } from 'react'
import { useWhisper } from './hooks/useWhisper'
import { checkGrammar } from './lib/grammar'
import MicButton from './components/MicButton'
import HighlightedText from './components/HighlightedText'
import ReadingTest from './components/ReadingTest'

export default function App() {
  const [mode, setMode] = useState('dictate') // dictate | read
  const asr = useWhisper()
  const { supported, loading, progress, listening, transcript, interim, error } =
    asr

  const [matches, setMatches] = useState([])
  const [grammarState, setGrammarState] = useState('idle') // idle | checking | error
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

  const toggle = () => (listening ? asr.stop() : asr.start())

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
      </header>

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

          <button
            className="clear"
            onClick={asr.reset}
            disabled={listening}
          >
            Clear
          </button>
        </>
      ) : (
        <ReadingTest {...asr} />
      )}
    </main>
  )
}
