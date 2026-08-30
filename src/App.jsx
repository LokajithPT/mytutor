import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWhisper } from './hooks/useWhisper'
import { checkGrammar } from './lib/grammar'
import { fetchTips } from './lib/tips'
import MicButton from './components/MicButton'
import MicSettings from './components/MicSettings'
import HighlightedText from './components/HighlightedText'
import ReadingTest from './components/ReadingTest'
import Home from './components/Home'
import ConversationCoach from './components/ConversationCoach'
import History from './components/History'
import ShadowDojo from './components/ShadowDojo'
import Rush from './components/Rush'
import Debate from './components/Debate'
import InterviewSim from './components/InterviewSim'
import { loadSessions } from './lib/history'

const MIC_STORAGE_KEY = 'mytutor.micId'
const GRAMMAR_STORAGE_KEY = 'mytutor.onlineGrammar'

const NAV = [
  { key: 'home', label: 'Home' },
  { key: 'dictate', label: 'Dictate' },
  { key: 'read', label: 'Reading' },
  { key: 'coach', label: 'Coach' },
  { key: 'ghost', label: 'Ghost' },
  { key: 'rush', label: 'Rush' },
  { key: 'debate', label: 'Debate' },
  { key: 'interview', label: 'Interview' },
  { key: 'history', label: 'Progress' },
]

export default function App() {
  const [mode, setMode] = useState('home')
  const [showMicPanel, setShowMicPanel] = useState(false)
  const [micId, setMicId] = useState(
    () => localStorage.getItem(MIC_STORAGE_KEY) || '',
  )
  const [onlineGrammar, setOnlineGrammar] = useState(
    () => localStorage.getItem(GRAMMAR_STORAGE_KEY) === '1',
  )
  const asr = useWhisper()
  const { supported, serverUp, listening, transcript, interim, error, speakingSeconds } = asr

  const selectMic = useCallback((id) => {
    setMicId(id)
    if (id) localStorage.setItem(MIC_STORAGE_KEY, id)
    else localStorage.removeItem(MIC_STORAGE_KEY)
  }, [])

  const toggleGrammar = useCallback(() => {
    setOnlineGrammar((v) => {
      const next = !v
      localStorage.setItem(GRAMMAR_STORAGE_KEY, next ? '1' : '0')
      return next
    })
  }, [])

  const [matches, setMatches] = useState([])
  const [grammarState, setGrammarState] = useState('idle') // idle | checking | error
  const [copied, setCopied] = useState(false)
  const [tips, setTips] = useState([])
  const [tipsLlmOk, setTipsLlmOk] = useState(true)
  const [tipsState, setTipsState] = useState('idle') // idle | loading | done | error
  const abortRef = useRef(null)

  const resetSession = useCallback(() => {
    asr.reset()
    setTips([])
    setTipsState('idle')
    setMatches([])
    setGrammarState('idle')
  }, [asr])

  const startWithDevice = useCallback(
    (opts) => asr.start({ ...opts, deviceId: micId || undefined }),
    [asr, micId],
  )

  const goMode = useCallback(
    (m) => {
      if (m === mode) return
      if (asr.listening) asr.stop()
      resetSession()
      setShowMicPanel(false)
      setMode(m)
    },
    [mode, asr, resetSession],
  )

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
        const found = await checkGrammar(transcript, {
          signal: ctrl.signal,
          online: onlineGrammar,
        })
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
  }, [transcript, mode, onlineGrammar])

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

  const lastSession = useMemo(() => {
    const all = loadSessions()
    if (!all.length) return null
    const s = all[all.length - 1]
    const when = new Date(s.date)
    const label = `${s.mode === 'coach' ? 'Coach' : 'Reading'} · ${when.toLocaleDateString()}`
    return { label }
  }, [mode])

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
        <button className="brand" onClick={() => goMode('home')}>
          mytutor
        </button>
        <nav className="nav" aria-label="Mode">
          {NAV.map((n) => (
            <button
              key={n.key}
              className={`nav-btn ${mode === n.key ? 'active' : ''}`}
              onClick={() => goMode(n.key)}
            >
              {n.label}
            </button>
          ))}
        </nav>
        <button
          className="settings-btn"
          aria-label="Microphone settings"
          title="Settings"
          onClick={() => setShowMicPanel((v) => !v)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" />
          </svg>
        </button>
      </header>

      {showMicPanel && (
        <MicSettings
          currentId={micId}
          onSelect={selectMic}
          onlineGrammar={onlineGrammar}
          onToggleGrammar={toggleGrammar}
        />
      )}

      {serverUp === 'down' && mode !== 'home' && mode !== 'history' && (
        <div className="server-banner">
          <strong>Speech server is not running.</strong>
          <span>In a second terminal:</span>
          <code>cd server &amp;&amp; uv run main.py</code>
          <code># or: pip install -r server/requirements.txt &amp;&amp; python main.py</code>
        </div>
      )}

      {mode === 'home' && <Home onSelect={goMode} lastSession={lastSession} />}

      {mode === 'dictate' && (
        <>
          <MicButton listening={listening} disabled={serverUp === 'down'} onToggle={toggle} />

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

          {grammarState === 'checking' && <p className="grammar-note">Checking grammar…</p>}
          {grammarState === 'error' && (
            <p className="grammar-note error">
              {onlineGrammar
                ? 'Grammar check unavailable (needs internet).'
                : 'Grammar check failed.'}
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
            <p className="grammar-note error">Review failed — is the speech server running?</p>
          )}

          {tipsState === 'done' && (
            <section className="tips">
              <h2>Better words {tips.some(t=>t.proverb) && '· proverbs'}</h2>
              {tips.length === 0 ? (
                <p className="tips-empty">
                  {tipsLlmOk ? 'Nothing to improve — nice one!' : 'Nemotron not reachable. Check server/.env NIM key.'}
                </p>
              ) : (
                <ul>
                  {tips.map((t, i) => (
                    <li key={i}>
                      <span className="tip-said">“{t.phrase}”</span>
                      <span className="tip-arrow">→</span>
                      <span className="tip-alts">{t.alternatives.join(', ')}</span>
                      {t.reason && <span className="tip-reason"> — {t.reason}</span>}
                      {t.proverb && <span style={{display:'block', color:'#f0b232', fontSize:'.85rem', marginTop:4}}>💡 {t.proverb}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      {mode === 'read' && <ReadingTest {...asr} start={startWithDevice} reset={resetSession} />}

      {mode === 'coach' && (
        <ConversationCoach
          {...asr}
          start={startWithDevice}
          reset={resetSession}
          speakingSeconds={speakingSeconds}
        />
      )}

      {mode === 'ghost' && <ShadowDojo {...asr} start={startWithDevice} reset={resetSession} />}
      {mode === 'rush' && <Rush {...asr} start={startWithDevice} reset={resetSession} />}
      {mode === 'debate' && <Debate {...asr} start={startWithDevice} reset={resetSession} />}
      {mode === 'interview' && <InterviewSim {...asr} start={startWithDevice} reset={resetSession} />}
      {mode === 'history' && <History />}

      <style>{`
        .brand { background:none; border:none; color:#e8eaed; font-size:1.25rem; font-weight:700; cursor:pointer; padding:0; }
        .nav { display:flex; gap:4px; margin-left:auto; background:#1a1d24; border:1px solid #2b2f3a; border-radius:10px; overflow:hidden; }
        .nav-btn { background:transparent; border:none; color:#9aa0a6; padding:8px 14px; cursor:pointer; font-size:.9rem; }
        .nav-btn.active { background:#2b2f3a; color:#e8eaed; }
        @media (max-width:680px){ .nav-btn { padding:7px 9px; font-size:.8rem; } .brand { font-size:1.1rem; } }
      `}</style>
    </main>
  )
}
