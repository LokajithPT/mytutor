const MODES = [
  { key: 'dictate', title: 'Dictate', desc: 'Live transcript, grammar flags and better-word tips from Nemotron.', color:'#8ab4f8', icon: ( <path d="M4 5h16v10H7l-3 3V5z" /> ) },
  { key: 'read', title: 'Reading', desc: 'AI generates level 1-10 passages — read aloud, get scored word by word.', color:'#81c995', icon: ( <path d="M4 5h16v3H4zM4 11h10v2H4zM4 16h16v2H4z" /> ) },
  { key: 'coach', title: 'Coach Chat', desc: 'Chat with Bhaskar, get scored on fluency, word choice and grammar.', color:'#f0b232', icon: ( <path d="M12 3a4 4 0 0 1 4 4v1h1a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3h1V7a4 4 0 0 1 4-4zm-2 9h4v2h-4v-2z" /> ) },
  { key: 'ghost', title: 'Ghost', desc: 'Shadow Bhaskar — listen, repeat and match timing.', color:'#a78bfa', icon: ( <path d="M12 2a7 7 0 0 0-7 7c0 2.5 1.2 4.7 3 6.1V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-1.9A7 7 0 0 0 12 2zm-2 12a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm4 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2z" /> ) },
  { key: 'rush', title: 'Rush', desc: '60s tongue-twister arcade — streaks and points.', color:'#f472b6', icon: ( <path d="M13 2L4 14h5l-1 6 9-12h-5l1-6z" /> ) },
  { key: 'debate', title: 'Debate', desc: 'Infinite debate vs Bhaskar — stop anytime for scoring.', color:'#f0b232', icon: ( <path d="M7 8h10M7 12h7M7 16h10M4 4h16v16H4z" /> ) },
  { key: 'interview', title: 'Interview', desc: 'IELTS mock with Bhaskar — band, points and coaching.', color:'#34d399', icon: ( <path d="M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM4 18a8 8 0 0 1 16 0v1H4z" /> ) },
  { key: 'history', title: 'Progress', desc: 'Scores, trends and weak-word bank — all local.', color:'#9aa0a6', icon: ( <path d="M7 17h2V9H7v8zm10 0h2V5h-2v12zm-5 0h2v-7h-2v7zM3 21h18v-2H3v2z" /> ) },
]

export default function Home({ onSelect, lastSession }) {
  return (
    <section className="home">
      <div className="hero">
        <div className="hero-badge">Private · Offline-first · Nemotron powered</div>
        <h1>Speak better English,<br/><span>one conversation at a time.</span></h1>
        <p className="hero-sub">Live speech-to-text, AI coaching with proverbs, and scoring that actually makes sense — fluency, word choice and grammar. No data leaves your machine.</p>
        <div className="hero-actions">
          <button className="hero-primary" onClick={()=> onSelect('coach')}>Start Chat with Bhaskar</button>
          <button className="hero-secondary" onClick={()=> onSelect('read')}>Try Reading</button>
        </div>
        <div className="hero-meta">
          <span>Level 1-10 reading</span><span className="dot">·</span><span>10-200 words</span><span className="dot">·</span><span>IELTS band</span>
        </div>
      </div>

      <div className="mode-grid">
        {MODES.map((m) => (
          <button key={m.key} className="mode-card" onClick={() => onSelect(m.key)} style={{'--accent': m.color}}>
            <div className="mode-icon" style={{background: `${m.color}14`, borderColor: `${m.color}30`, color: m.color}}>
              <svg viewBox="0 0 24 24" aria-hidden="true">{m.icon}</svg>
            </div>
            <h3>{m.title}</h3>
            <p>{m.desc}</p>
            <span className="card-arrow">→</span>
          </button>
        ))}
      </div>

      <div className="steps">
        <div className="step"><span>1</span><h4>Speak</h4><p>Mic captures at 16kHz, Whisper gives word timestamps.</p></div>
        <div className="step"><span>2</span><h4>Get coached</h4><p>Nemotron gives word tips, proverbs and fluency feedback.</p></div>
        <div className="step"><span>3</span><h4>Improve</h4><p>Track points, band and weak words in Progress.</p></div>
      </div>

      {lastSession && <p className="home-last">Last session: <strong>{lastSession.label}</strong></p>}

      <style>{`
        .home { width:100%; max-width: 920px; display:flex; flex-direction:column; align-items:center; gap:28px; }
        .hero { width:100%; text-align:center; padding: 28px 18px 10px; background: radial-gradient(500px 220px at 50% -20%, rgba(138,180,248,0.16), transparent 70%), linear-gradient(180deg, rgba(26,29,36,0.9), transparent); border:1px solid var(--line); border-radius: 18px; box-shadow: var(--shadow); }
        .hero-badge { display:inline-block; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color: var(--blue); background: rgba(138,180,248,0.1); border:1px solid rgba(138,180,248,0.22); padding:6px 10px; border-radius:99px; margin-bottom:14px; }
        .hero h1 { font-size: clamp(1.7rem, 4vw, 2.2rem); font-weight:700; letter-spacing:-.03em; line-height:1.15; color: var(--text); }
        .hero h1 span { background: linear-gradient(90deg, #8ab4f8, #81c995); -webkit-background-clip:text; -webkit-text-fill-color: transparent; }
        .hero-sub { color: var(--muted); font-size: .96rem; max-width: 640px; margin: 12px auto 0; line-height:1.6; }
        .hero-actions { display:flex; gap:10px; justify-content:center; margin-top:18px; flex-wrap:wrap; }
        .hero-primary { background: linear-gradient(180deg, #2a3a5e, #1e2b4a); border:1px solid rgba(138,180,248,0.4); color:#eef1f6; padding:10px 18px; border-radius:10px; font-weight:600; cursor:pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.25); transition:.18s; }
        .hero-primary:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(0,0,0,0.3), 0 0 0 3px rgba(138,180,248,0.12); }
        .hero-secondary { background: transparent; border:1px solid var(--line2); color: var(--text); padding:10px 18px; border-radius:10px; font-weight:500; cursor:pointer; transition:.18s; }
        .hero-secondary:hover { border-color: rgba(255,255,255,0.16); background: rgba(255,255,255,0.04); }
        .hero-meta { display:flex; gap:8px; justify-content:center; align-items:center; margin-top:14px; color: var(--dim); font-size:12px; }
        .dot { opacity:.5; }
        .mode-grid { display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap:14px; width:100%; }
        .mode-card { position:relative; text-align:left; background: var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; cursor:pointer; color:inherit; font:inherit; transition: all .22s ease; overflow:hidden; }
        .mode-card::after { content:""; position:absolute; inset:0; background: radial-gradient(300px 200px at 80% -20%, var(--accent, #8ab4f8) , transparent 60%); opacity:.08; pointer-events:none; transition:.22s; }
        .mode-card:hover { transform: translateY(-3px); border-color: rgba(255,255,255,0.12); box-shadow: 0 10px 30px rgba(0,0,0,0.35); }
        .mode-card:hover::after { opacity:.14; }
        .mode-card:active { transform: translateY(-1px) scale(.99); }
        .mode-icon { width:36px; height:36px; border-radius:10px; border:1px solid; display:flex; align-items:center; justify-content:center; margin-bottom:10px; }
        .mode-icon svg { width:18px; height:18px; fill: currentColor; }
        .mode-card h3 { font-size:.96rem; font-weight:600; color:var(--text); margin-bottom:4px; }
        .mode-card p { color: var(--muted); font-size:.82rem; line-height:1.5; min-height:36px; }
        .card-arrow { position:absolute; right:14px; bottom:12px; color: var(--muted); font-size:14px; opacity:0; transform: translateX(-4px); transition:.18s; }
        .mode-card:hover .card-arrow { opacity:1; transform:none; color: var(--text); }
        .steps { display:grid; grid-template-columns: repeat(3,1fr); gap:12px; width:100%; }
        .step { background: var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; text-align:center; }
        .step span { display:inline-flex; width:28px; height:28px; align-items:center; justify-content:center; border-radius:99px; background: rgba(138,180,248,0.14); border:1px solid rgba(138,180,248,0.25); color: var(--blue); font-weight:700; font-size:12px; margin-bottom:8px; }
        .step h4 { font-size:.9rem; color:var(--text); margin-bottom:4px; }
        .step p { font-size:.82rem; color:var(--muted); line-height:1.5; }
        .home-last { color: var(--muted); font-size:0.84rem; background: rgba(255,255,255,0.03); border:1px solid var(--line); padding:6px 10px; border-radius:99px; }
        @media (max-width: 860px){ .mode-grid { grid-template-columns: repeat(2, minmax(0,1fr)); } .steps { grid-template-columns:1fr; } }
        @media (max-width: 520px){ .mode-grid { grid-template-columns:1fr; } }
      `}</style>
    </section>
  )
}
