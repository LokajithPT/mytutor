import { useEffect, useMemo, useRef, useState } from 'react'
import MicButton from './MicButton'
import { analyzeFluency, gradeFor } from '../lib/fluency'
import { fetchTips } from '../lib/tips'
import { saveSession, addWeakWords } from '../lib/history'

const PROMPTS = [
  {
    label: 'Everyday',
    text: 'Describe what you did last weekend, and one thing you wish had gone differently.',
  },
  {
    label: 'Opinion',
    text: 'Argue for or against working from home. Give two reasons you actually believe.',
  },
  {
    label: 'Story',
    text: 'Tell a short story about a time you learned something the hard way.',
  },
  {
    label: 'Explain',
    text: 'Explain how something you use every day works, as if to a curious child.',
  },
]

function ScoreRing({ score, size = 150, stroke = 13 }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const off = c * (1 - Math.max(0, Math.min(100, score)) / 100)
  const color =
    score >= 85 ? '#81c995' : score >= 70 ? '#8ab4f8' : score >= 50 ? '#f0b232' : '#ea4335'
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="score-ring">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="#2b2f3a" strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={off}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset .6s ease' }}
      />
      <text x="50%" y="46%" textAnchor="middle" className="score-num" fill={color}>
        {Math.round(score)}
      </text>
      <text x="50%" y="62%" textAnchor="middle" className="score-grade" fill="#9aa0a6">
        {gradeFor(score)}
      </text>
    </svg>
  )
}

export default function ConversationCoach({
  serverUp,
  listening,
  transcript,
  interim,
  error,
  speakingSeconds,
  start,
  stop,
  reset,
}) {
  const [prompt, setPrompt] = useState(PROMPTS[0].text)
  const [phase, setPhase] = useState('setup') // setup | running | done
  const [elapsed, setElapsed] = useState(0)
  const [summary, setSummary] = useState(null)
  const [summaryLlmOk, setSummaryLlmOk] = useState(true)
  const [summaryState, setSummaryState] = useState('idle') // idle|loading|done|empty|error
  const [tips, setTips] = useState([])
  const [tipsLlmOk, setTipsLlmOk] = useState(true)
  const [tipsState, setTipsState] = useState('idle')
  const [saved, setSaved] = useState(false)

  const elapsedRef = useRef(0)
  const transcriptRef = useRef('')
  const fluencyRef = useRef(null)
  const reviewedRef = useRef(false)

  // Keep refs in sync for use in async callbacks.
  transcriptRef.current = transcript
  elapsedRef.current = elapsed

  const fluency = useMemo(
    () => analyzeFluency(transcript, { elapsedSeconds: elapsed, speakingSeconds }),
    [transcript, elapsed, speakingSeconds],
  )
  fluencyRef.current = fluency

  useEffect(() => {
    if (phase !== 'running') return
    const id = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [phase])

  function begin() {
    if (!prompt.trim()) return
    setElapsed(0)
    elapsedRef.current = 0
    setPhase('running')
    setSummary(null)
    setTips([])
    setSummaryState('idle')
    setTipsState('idle')
    setSaved(false)
    reviewedRef.current = false
    start()
  }

  function runReview() {
    const text = (transcriptRef.current || '').trim()
    if (!text) {
      setSummaryState('empty')
      return
    }
    setSummaryState('loading')
    setTipsState('loading')
    Promise.allSettled([
      fetchTips(text, { mode: 'conversation_summary' }),
      fetchTips(text, { mode: 'word_choice' }),
    ])
      .then(([s, t]) => {
        const sum = s.status === 'fulfilled' ? s.value : { summary: null, llmOk: false }
        const tip = t.status === 'fulfilled' ? t.value : { tips: [], llmOk: true }
        setSummary(sum.summary)
        setSummaryLlmOk(sum.llmOk !== false)
        setTips(tip.tips || [])
        setTipsLlmOk(tip.llmOk !== false)
        setSummaryState('done')
        setTipsState('done')

        const f = fluencyRef.current || analyzeFluency(text, { elapsedSeconds: elapsedRef.current })
        saveSession({
          mode: 'coach',
          date: Date.now(),
          durationSec: elapsedRef.current,
          fluencyScore: f.score,
          wpm: f.wpm,
          fillerCount: f.fillerCount,
          fillerRatio: f.fillerRatio,
          wordCount: f.wordCount,
          llmOk: sum.llmOk !== false,
        })
        if ((tip.tips || []).length) addWeakWords(tip.tips.map((x) => x.phrase))
        setSaved(true)
      })
      .catch(() => setSummaryState('error'))
  }

  // Trigger the review once the session is finalized (mic stopped).
  useEffect(() => {
    if (phase === 'done' && !reviewedRef.current) {
      reviewedRef.current = true
      const text = (transcriptRef.current || '').trim()
      if (!text) {
        setSummaryState('empty')
        return
      }
      runReview()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  function toggle() {
    if (listening) {
      Promise.resolve(stop()).then(() => setPhase('done'))
    } else if (phase === 'done' || phase === 'running') {
      reset()
      begin()
    } else {
      begin()
    }
  }

  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
  const fillerPct = Math.round(fluency.fillerRatio * 100)
  const speakPct = fluency.speakingRatio != null ? Math.round(fluency.speakingRatio * 100) : null

  if (phase === 'setup') {
    return (
      <section className="coach coach-setup">
        <h2>Conversation Coach</h2>
        <p className="coach-sub">Pick a prompt, speak for a minute or two, then get coached.</p>
        <div className="prompt-grid">
          {PROMPTS.map((p) => (
            <button
              key={p.label}
              className={`prompt-card ${prompt === p.text ? 'active' : ''}`}
              onClick={() => setPrompt(p.text)}
            >
              <span className="prompt-label">{p.label}</span>
              <span className="prompt-text">{p.text}</span>
            </button>
          ))}
        </div>
        <textarea
          className="paragraph-input"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="…or write your own prompt"
        />
        <MicButton
          listening={false}
          disabled={serverUp === 'down' || !prompt.trim()}
          onToggle={toggle}
        />
        <p className="status">
          {serverUp === 'down'
            ? 'Speech server offline — start it first.'
            : 'Click the mic and start talking'}
        </p>
        <style>{`
          .coach-setup { width:100%; max-width:720px; display:flex; flex-direction:column; align-items:center; gap:16px; }
          .coach-setup h2 { font-size:1.3rem; color:#e8eaed; }
          .coach-sub { color:#9aa0a6; font-size:.9rem; }
          .prompt-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; width:100%; }
          .prompt-card { text-align:left; background:#1a1d24; border:1px solid #2b2f3a; border-radius:12px; padding:14px; cursor:pointer; color:inherit; font:inherit; display:flex; flex-direction:column; gap:6px; }
          .prompt-card.active { border-color:#8ab4f8; }
          .prompt-label { font-size:.75rem; text-transform:uppercase; letter-spacing:.05em; color:#8ab4f8; }
          .prompt-text { font-size:.9rem; color:#cdd1d6; line-height:1.45; }
          @media (max-width:560px){ .prompt-grid { grid-template-columns:1fr; } }
        `}</style>
      </section>
    )
  }

  return (
    <section className="coach coach-run">
      <div className="coach-top">
        <div className="coach-prompt">
          <span className="prompt-label">Prompt</span>
          <p>{prompt}</p>
        </div>
        <div className="coach-clock">{clock}</div>
      </div>

      <MicButton listening={listening} disabled={serverUp === 'down'} onToggle={toggle} />

      <p className="status">
        {error
          ? `Error: ${error}`
          : listening
            ? 'Listening… click to finish'
            : phase === 'done'
              ? 'Session complete'
              : 'Click the mic to start'}
      </p>

      {/* Live metrics while running */}
      <div className="coach-metrics">
        <div className="metric">
          <span className="metric-num">{fluency.wpm ?? '–'}</span>
          <span className="metric-lab">words/min</span>
        </div>
        <div className="metric">
          <span className="metric-num">{fluency.fillerCount}</span>
          <span className="metric-lab">fillers ({fillerPct}%)</span>
        </div>
        <div className="metric">
          <span className="metric-num">{fluency.uniqueCount}</span>
          <span className="metric-lab">unique words</span>
        </div>
        <div className="metric">
          <span className="metric-num">{speakPct != null ? `${speakPct}%` : '–'}</span>
          <span className="metric-lab">speaking time</span>
        </div>
      </div>

      <section className="transcript" aria-live="polite">
        <span className="final">{transcript}</span>
        <span className="interim">{interim}</span>
        {listening && <span className="caret" />}
      </section>

      {phase === 'done' && (
        <CoachSummary
          fluency={fluency}
          summary={summary}
          summaryLlmOk={summaryLlmOk}
          summaryState={summaryState}
          tips={tips}
          tipsLlmOk={tipsLlmOk}
          tipsState={tipsState}
          saved={saved}
          onRestart={toggle}
        />
      )}

      <style>{`
        .coach-run { width:100%; max-width:720px; display:flex; flex-direction:column; align-items:center; gap:16px; }
        .coach-top { width:100%; display:flex; gap:14px; align-items:flex-start; }
        .coach-prompt { flex:1; background:#1a1d24; border:1px solid #2b2f3a; border-radius:12px; padding:14px 16px; }
        .coach-prompt p { color:#e8eaed; font-size:1rem; line-height:1.5; margin-top:4px; }
        .coach-clock { font-variant-numeric:tabular-nums; font-size:1.4rem; color:#8ab4f8; padding-top:14px; }
        .coach-metrics { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; width:100%; }
        .metric { background:#1a1d24; border:1px solid #2b2f3a; border-radius:10px; padding:12px; text-align:center; }
        .metric-num { display:block; font-size:1.4rem; font-weight:600; color:#e8eaed; font-variant-numeric:tabular-nums; }
        .metric-lab { font-size:.72rem; color:#9aa0a6; }
        @media (max-width:560px){ .coach-metrics { grid-template-columns:repeat(2,1fr); } }
      `}</style>
    </section>
  )
}

function CoachSummary({
  fluency,
  summary,
  summaryLlmOk,
  summaryState,
  tips,
  tipsLlmOk,
  tipsState,
  saved,
  onRestart,
}) {
  return (
    <div className="coach-summary">
      <ScoreRing score={fluency.score} />

      <div className="summary-metrics">
        <span className="stat-good">{fluency.wordCount} words</span>
        <span className="stat-sep">·</span>
        <span className={fluency.fillerCount > 6 ? 'stat-bad' : 'stat-dim'}>
          {fluency.fillerCount} fillers
        </span>
        <span className="stat-sep">·</span>
        <span className="stat-dim">
          {fluency.wpm ?? '–'} wpm
        </span>
      </div>

      {summaryState === 'loading' && <p className="grammar-note">Coaching…</p>}
      {summaryState === 'error' && (
        <p className="grammar-note error">Coaching failed — is the speech server running?</p>
      )}
      {summaryState === 'empty' && (
        <p className="grammar-note">No speech detected to coach.</p>
      )}

      {summaryState === 'done' && summary && (
        <div className="summary-block">
          {summary.headline && <p className="summary-headline">“{summary.headline}”</p>}
          {summary.strengths?.length > 0 && (
            <div className="summary-col">
              <h4 className="good">Strengths</h4>
              <ul>
                {summary.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.improvements?.length > 0 && (
            <div className="summary-col">
              <h4 className="warn">To improve</h4>
              <ul>
                {summary.improvements.map((imp, i) => (
                  <li key={i}>
                    {imp.area && <span className="imp-area">{imp.area}: </span>}
                    {imp.tip}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.proverbs?.length > 0 && (
            <div className="summary-col">
              <h4 className="good">Proverbs & Idioms</h4>
              <ul>
                {summary.proverbs.map((p,i)=> <li key={i}><span className="imp-area">{p.saying}</span> — {p.meaning}{p.example && <><br/><span style={{color:'#9aa0a6', fontSize:'.85rem'}}>e.g. {p.example}</span></>}</li>)}
              </ul>
            </div>
          )}
          {!summaryLlmOk && (
            <p className="grammar-note error">
              Nemotron not reachable — check server/.env NIM key.
            </p>
          )}
        </div>
      )}

      {tipsState === 'done' && (
        <section className="tips">
          <h2>Better words {tips.some(t=>t.proverb) && '· proverbs'}</h2>
          {tips.length === 0 ? (
            <p className="tips-empty">
              {tipsLlmOk ? 'Nothing to improve — nice one!' : 'Nemotron not reachable. Check NIM.'}
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

      {saved && <p className="saved-note">Saved to your progress ✓</p>}

      <button className="review" onClick={onRestart}>
        Practice again
      </button>

      <style>{`
        .coach-summary { width:100%; max-width:640px; display:flex; flex-direction:column; align-items:center; gap:14px; animation:fade-up .4s ease; }
        @keyframes fade-up { from { opacity:0; transform:translateY(8px);} to {opacity:1; transform:none;} }
        .score-ring { display:block; }
        .score-num { font-size:2.4rem; font-weight:700; font-family:ui-monospace,monospace; }
        .score-grade { font-size:.8rem; }
        .summary-metrics { color:#9aa0a6; font-size:.95rem; }
        .summary-block { width:100%; background:#1a1d24; border:1px solid #2b3a4a; border-radius:12px; padding:18px 20px; display:flex; flex-direction:column; gap:12px; }
        .summary-headline { color:#e8eaed; font-size:1.05rem; line-height:1.5; font-style:italic; }
        .summary-col h4 { font-size:.8rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:6px; }
        .summary-col h4.good { color:#81c995; }
        .summary-col h4.warn { color:#f0b232; }
        .summary-col ul { list-style:none; display:flex; flex-direction:column; gap:6px; }
        .summary-col li { font-size:.92rem; color:#cdd1d6; line-height:1.45; }
        .imp-area { color:#f0b232; font-weight:600; }
        .saved-note { color:#81c995; font-size:.85rem; }
      `}</style>
    </div>
  )
}
