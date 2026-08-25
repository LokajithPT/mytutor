import { useEffect, useMemo, useRef, useState } from 'react'
import MicButton from './MicButton'
import { alignSpoken, tokenize } from '../lib/align'

// Simple common words, no proper nouns — easy for the model to follow.
const EASY_PRACTICE = `The sun rises in the east and sets in the west. Every morning, she walks to the park near her house. She likes to watch the birds and listen to the wind in the trees. After her walk, she drinks a cup of tea and reads the news. In the evening, her family sits together and talks about their day.`

const SELF_INTRO = `Good morning everyone. My name is Arun Kumar, and I am from Coimbatore, Tamil Nadu. I am currently pursuing my degree in English. I have always been interested in language, literature, and communication, which encouraged me to choose English as my area of study. I enjoy reading books, listening to music, and watching movies during my free time. I also like spending time with my friends and family. I would describe myself as a friendly, responsible, and hardworking person. I enjoy participating in classroom discussions, presentations, and other academic activities. These experiences have helped me improve my confidence and communication skills. I am always interested in learning something new and developing my abilities. I believe that every experience gives us an opportunity to learn and grow. One of my strengths is my willingness to accept challenges and learn from my mistakes. At the same time, I am working on becoming more confident while speaking in public. My immediate goal is to perform well in my studies and improve my skills. In the future, I would like to build a successful career in a field that matches my interests. I believe that dedication, patience, and continuous learning will help me achieve my goals. Thank you for giving me this opportunity to introduce myself.`

const PRESETS = [
  { label: 'Easy practice', text: EASY_PRACTICE },
  { label: 'Self-introduction', text: SELF_INTRO },
]

export default function ReadingTest({
  serverUp,
  listening,
  transcript,
  interim,
  error,
  start,
  stop,
  reset,
}) {
  const [text, setText] = useState(EASY_PRACTICE)
  const [phase, setPhase] = useState('setup') // setup | running | done
  const [elapsed, setElapsed] = useState(0)
  const textBoxRef = useRef(null)

  const words = useMemo(() => tokenize(text), [text])

  const { status, pointer, extras } = useMemo(() => {
    const spoken = tokenize(transcript)
    return alignSpoken(spoken, words, { finalize: phase === 'done' })
  }, [transcript, words, phase])

  // Keep the word being read in view.
  useEffect(() => {
    const box = textBoxRef.current
    if (!box) return
    const el = box.querySelector('[data-current="true"]')
    if (!el) return
    box.scrollTo({
      top: Math.max(0, el.offsetTop - box.clientHeight / 2),
      behavior: 'smooth',
    })
  }, [pointer])

  // Reading timer.
  useEffect(() => {
    if (phase !== 'running') return
    const id = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [phase])

  const correctCount = status.filter((s) => s === 'correct').length
  const missedCount = status.filter(
    (s) => s === 'missed' || s === 'incorrect',
  ).length
  const accuracy =
    words.length > 0 ? Math.round((correctCount / words.length) * 100) : 0
  const wpm = elapsed >= 5 ? Math.round((correctCount / elapsed) * 60) : null
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`

  function begin() {
    if (!text.trim()) return
    setElapsed(0)
    setPhase('running')
    start()
  }

  function toggle() {
    if (listening) {
      // Wait for the final transcription flush before scoring.
      Promise.resolve(stop()).then(() => setPhase('done'))
    } else if (phase === 'done' || phase === 'running') {
      reset()
      begin()
    } else {
      begin()
    }
  }

  const micLabel =
    phase === 'setup'
      ? 'Click the mic, then read the paragraph aloud'
      : listening
        ? 'Reading… click to finish'
        : 'Click the mic to restart the test'

  return (
    <section className="reading">
      <div className="reading-head">
        {phase === 'setup' ? (
          <>
            <div className="presets">
              {PRESETS.map((p) => (
                <button
                  key={p.label}
                  className={`preset ${text === p.text ? 'active' : ''}`}
                  onClick={() => setText(p.text)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <textarea
              className="paragraph-input"
              rows={7}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste a paragraph to read…"
            />
          </>
        ) : (
          <p className="status">
            {error
              ? `Error: ${error}`
              : serverUp === 'down'
                ? 'Speech server offline — start it, then restart the test'
                : `${micLabel} — ${listening ? 'listening' : phase}`}
          </p>
        )}
      </div>

      <MicButton
        listening={listening}
        disabled={serverUp === 'down' || !text.trim()}
        onToggle={toggle}
      />

      {(phase === 'running' || phase === 'done') && (
        <>
          <div className="reading-stats">
            <span className="stat-good">{correctCount}</span>
            <span className="stat-dim">/{words.length} words</span>
            <span className="stat-sep">·</span>
            <span className={accuracy >= 90 ? 'stat-good' : 'stat-bad'}>
              {accuracy}% accuracy
            </span>
            {missedCount > 0 && (
              <>
                <span className="stat-sep">·</span>
                <span className="stat-bad">{missedCount} wrong/skipped</span>
              </>
            )}
            <span className="stat-sep">·</span>
            <span className="stat-dim">{clock}</span>
            {wpm != null && (
              <>
                <span className="stat-sep">·</span>
                <span className="stat-dim">{wpm} wpm</span>
              </>
            )}
          </div>

          <div className="reading-text" ref={textBoxRef} aria-live="polite">
            {words.map((word, i) => (
              <span key={i}>
                <span
                  data-current={i === pointer && phase === 'running'}
                  className={`rw ${status[i]} ${
                    i === pointer && phase === 'running' ? 'current' : ''
                  }`}
                >
                  {word}
                </span>{' '}
              </span>
            ))}
          </div>

          {interim && <p className="interim-line">{interim}</p>}

          {extras.length > 0 && (
            <p className="extras-line">
              extra:{' '}
              {extras.map((w, i) => (
                <span key={i} className="extra-word">
                  +{w}{' '}
                </span>
              ))}
            </p>
          )}
        </>
      )}
    </section>
  )
}
