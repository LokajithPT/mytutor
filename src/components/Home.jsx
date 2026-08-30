const MODES = [
  {
    key: 'dictate',
    title: 'Dictate',
    desc: 'Talk freely. Live transcript, grammar flags, and better-word tips.',
    icon: (
      <path d="M4 5h16v10H7l-3 3V5z" />
    ),
  },
  {
    key: 'read',
    title: 'Reading Test',
    desc: 'Read a paragraph aloud — words light up as you nail them, Monkeytype-style.',
    icon: (
      <path d="M4 5h16v3H4zM4 11h10v2H4zM4 16h16v2H4z" />
    ),
  },
  {
    key: 'coach',
    title: 'Conversation Coach',
    desc: 'Answer a prompt, get a fluency score, filler check, and AI coaching.',
    icon: (
      <path d="M12 3a4 4 0 0 1 4 4v1h1a3 3 0 0 1 3 3v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-5a3 3 0 0 1 3-3h1V7a4 4 0 0 1 4-4zm-2 9h4v2h-4v-2z" />
    ),
  },
  {
    key: 'history',
    title: 'Progress',
    desc: 'Your past sessions, scores over time, and a weak-word bank.',
    icon: (
      <path d="M5 19V9m5 10V5m5 14v-7M3 21h18" />
    ),
  },
]

export default function Home({ onSelect, lastSession }) {
  return (
    <section className="home">
      <p className="home-tag">
        Speak. See your words. Get coached — everything runs on your machine.
      </p>
      <div className="mode-grid">
        {MODES.map((m) => (
          <button key={m.key} className="mode-card" onClick={() => onSelect(m.key)}>
            <svg className="mode-card-icon" viewBox="0 0 24 24" aria-hidden="true">
              {m.icon}
            </svg>
            <h3>{m.title}</h3>
            <p>{m.desc}</p>
          </button>
        ))}
      </div>
      {lastSession && (
        <p className="home-last">
          Last session: <strong>{lastSession.label}</strong>
        </p>
      )}
      <style>{`
        .home { width: 100%; max-width: 880px; display: flex; flex-direction: column; align-items: center; gap: 22px; }
        .home-tag { color: #9aa0a6; font-size: 1.05rem; text-align: center; max-width: 560px; }
        .mode-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; width: 100%; }
        .mode-card { text-align: left; background: #1a1d24; border: 1px solid #2b2f3a; border-radius: 14px; padding: 20px; cursor: pointer; color: inherit; font: inherit; transition: border-color .15s, transform .15s; }
        .mode-card:hover { border-color: #8ab4f8; transform: translateY(-2px); }
        .mode-card-icon { width: 30px; height: 30px; fill: #8ab4f8; margin-bottom: 10px; }
        .mode-card h3 { font-size: 1.05rem; margin-bottom: 6px; color: #e8eaed; }
        .mode-card p { color: #9aa0a6; font-size: 0.88rem; line-height: 1.5; }
        .home-last { color: #9aa0a6; font-size: 0.85rem; }
        @media (max-width: 560px) { .mode-grid { grid-template-columns: 1fr; } }
      `}</style>
    </section>
  )
}
