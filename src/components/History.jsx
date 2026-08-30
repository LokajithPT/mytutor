import { useMemo, useState } from 'react'
import { loadSessions, loadWeakWords, clearSessions, clearWeakWords, sessionScore } from '../lib/history'

function ScoreBars({ items }) {
  if (!items.length) return null
  const w = 640
  const h = 140
  const pad = 24
  const max = 100
  const bw = (w - pad * 2) / items.length
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} width="100%" preserveAspectRatio="xMidYMid meet">
      {[0, 25, 50, 75, 100].map((g) => {
        const y = h - pad - (g / max) * (h - pad * 2)
        return (
          <g key={g}>
            <line x1={pad} y1={y} x2={w - pad} y2={y} stroke="#2b2f3a" strokeWidth="1" />
            <text x={4} y={y + 3} fill="#5f6368" fontSize="9">{g}</text>
          </g>
        )
      })}
      {items.map((it, i) => {
        const val = it.score ?? 0
        const bh = (val / max) * (h - pad * 2)
        const x = pad + i * bw + bw * 0.2
        const bwReal = bw * 0.6
        const y = h - pad - bh
        const color = val >= 85 ? '#81c995' : val >= 70 ? '#8ab4f8' : val >= 50 ? '#f0b232' : '#ea4335'
        return (
          <g key={i}>
            <rect x={x} y={y} width={bwReal} height={bh} rx="3" fill={color} />
            <text x={x + bwReal / 2} y={y - 4} fill="#9aa0a6" fontSize="9" textAnchor="middle">
              {Math.round(val)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function Sparkline({ values }) {
  if (values.length < 2) return <span className="empty-note">Not enough data yet.</span>
  const w = 640
  const h = 60
  const pad = 6
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const pts = values
    .map((v, i) => {
      const x = pad + (i / (values.length - 1)) * (w - pad * 2)
      const y = h - pad - ((v - min) / span) * (h - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} width="100%" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke="#8ab4f8" strokeWidth="2" />
    </svg>
  )
}

export default function History() {
  const [tick, setTick] = useState(0)
  const sessions = useMemo(() => loadSessions(), [tick])
  const weak = useMemo(() => loadWeakWords(), [tick])

  const scored = useMemo(
    () => sessions.map((s) => ({ ...s, score: sessionScore(s) })).filter((s) => s.score != null),
    [sessions],
  )
  const weakEntries = useMemo(
    () => Object.entries(weak).sort((a, b) => b[1] - a[1]),
    [weak],
  )

  const stats = useMemo(() => {
    const coach = sessions.filter((s) => s.mode === 'coach')
    const reads = sessions.filter((s) => s.mode === 'read')
    const avg = (arr, key) => (arr.length ? Math.round(arr.reduce((a, s) => a + (s[key] || 0), 0) / arr.length) : null)
    return {
      total: sessions.length,
      coachAvg: avg(coach, 'fluencyScore'),
      readAvg: avg(reads, 'accuracy'),
      avgWpm: avg(coach, 'wpm'),
      totalWords: coach.reduce((a, s) => a + (s.wordCount || 0), 0),
      totalFillers: coach.reduce((a, s) => a + (s.fillerCount || 0), 0),
    }
  }, [sessions])

  return (
    <section className="history">
      <h2>Your Progress</h2>

      <div className="stat-cards">
        <div className="stat-card">
          <span className="stat-value">{stats.total}</span>
          <span className="stat-label">sessions</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.coachAvg ?? '–'}</span>
          <span className="stat-label">avg coach score</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.avgWpm ?? '–'}</span>
          <span className="stat-label">avg wpm</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats.totalFillers}</span>
          <span className="stat-label">fillers total</span>
        </div>
      </div>

      <div className="history-block">
        <h3>Score trend</h3>
        {scored.length ? (
          <>
            <ScoreBars items={scored.slice(-12)} />
            <Sparkline values={scored.slice(-12).map((s) => s.score)} />
          </>
        ) : (
          <p className="empty-note">No scored sessions yet — try the Reading Test or Coach.</p>
        )}
      </div>

      <div className="history-block">
        <h3>Weak-word bank</h3>
        {weakEntries.length ? (
          <div className="weak-tags">
            {weakEntries.map(([w, n]) => (
              <span key={w} className="weak-tag" title={`seen ${n}×`}>
                {w} <span className="weak-n">×{n}</span>
              </span>
            ))}
          </div>
        ) : (
          <p className="empty-note">No weak words tracked yet.</p>
        )}
      </div>

      <div className="history-actions">
        <button
          className="clear"
          onClick={() => {
            clearSessions()
            setTick((t) => t + 1)
          }}
        >
          Clear sessions
        </button>
        <button
          className="clear"
          onClick={() => {
            clearWeakWords()
            setTick((t) => t + 1)
          }}
        >
          Clear weak words
        </button>
      </div>

      <style>{`
        .history { width:100%; max-width:720px; display:flex; flex-direction:column; gap:18px; }
        .history h2 { font-size:1.3rem; color:#e8eaed; }
        .stat-cards { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
        .stat-card { background:#1a1d24; border:1px solid #2b2f3a; border-radius:12px; padding:14px; text-align:center; }
        .stat-value { display:block; font-size:1.5rem; font-weight:700; color:#8ab4f8; font-variant-numeric:tabular-nums; }
        .stat-label { font-size:.72rem; color:#9aa0a6; }
        .history-block { background:#1a1d24; border:1px solid #2b2f3a; border-radius:12px; padding:16px 18px; }
        .history-block h3 { font-size:.9rem; color:#9aa0a6; margin-bottom:12px; text-transform:uppercase; letter-spacing:.05em; }
        .chart { display:block; }
        .weak-tags { display:flex; flex-wrap:wrap; gap:8px; }
        .weak-tag { background:#12141a; border:1px solid #2b3a4a; color:#f0b232; border-radius:99px; padding:4px 12px; font-size:.85rem; }
        .weak-n { color:#5f6368; font-size:.75rem; }
        .empty-note { color:#9aa0a6; font-size:.9rem; }
        .history-actions { display:flex; gap:10px; }
        @media (max-width:560px){ .stat-cards { grid-template-columns:repeat(2,1fr); } }
      `}</style>
    </section>
  )
}
