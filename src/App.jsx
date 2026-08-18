import { useEffect, useMemo, useRef, useState } from 'react'
import { useVosk } from './hooks/useVosk'
import { checkGrammar } from './lib/grammar'
import MicButton from './components/MicButton'
import HighlightedText from './components/HighlightedText'

export default function App() {
  const {
    supported,
    loading,
    listening,
    transcript,
    interim,
    error,
    start,
    stop,
    reset,
  } = useVosk({ lang: 'en-US' })

  const [matches, setMatches] = useState([])
  const [grammarState, setGrammarState] = useState('idle') // idle | checking | error
  const abortRef = useRef(null)

  // Run grammar check on the finalized transcript (debounced). The original
  // text is never changed — we only collect error spans to highlight.
  useEffect(() => {
    if (!transcript.trim()) {
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
  }, [transcript])

  const toggle = () => (listening ? stop() : start())

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
      <h1>Live Speech to Text</h1>

      <MicButton listening={listening} disabled={loading} onToggle={toggle} />

      <p className="status">
        {loading
          ? 'Loading offline model (first time only)…'
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
                <span className="issue-phrase">“{m.phrase}”</span> — {m.message}
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

      <button className="clear" onClick={reset} disabled={listening}>
        Clear
      </button>
    </main>
  )
}
