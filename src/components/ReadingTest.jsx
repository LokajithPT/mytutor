import { useMemo, useState } from 'react'
import MicButton from './MicButton'
import { alignSpoken, normalizeWord, tokenize } from '../lib/align'

const SELF_INTRO = `Good morning everyone. My name is Arun Kumar, and I am from Coimbatore, Tamil Nadu. I am currently pursuing my degree in English. I have always been interested in language, literature, and communication, which encouraged me to choose English as my area of study. I enjoy reading books, listening to music, and watching movies during my free time. I also like spending time with my friends and family. I would describe myself as a friendly, responsible, and hardworking person. I enjoy participating in classroom discussions, presentations, and other academic activities. These experiences have helped me improve my confidence and communication skills. I am always interested in learning something new and developing my abilities. I believe that every experience gives us an opportunity to learn and grow. One of my strengths is my willingness to accept challenges and learn from my mistakes. At the same time, I am working on becoming more confident while speaking in public. My immediate goal is to perform well in my studies and improve my skills. In the future, I would like to build a successful career in a field that matches my interests. I believe that dedication, patience, and continuous learning will help me achieve my goals. Thank you for giving me this opportunity to introduce myself.`

const PRESETS = [{ label: 'Self-introduction 1', text: SELF_INTRO }]

export default function ReadingTest({
  loading,
  listening,
  transcript,
  interim,
  error,
  start,
  stop,
  reset,
}) {
  const [text, setText] = useState(SELF_INTRO)
  const [phase, setPhase] = useState('setup') // setup | running | done

  const words = useMemo(() => tokenize(text), [text])

  // Vocabulary whitelist: constrain the recognizer to the paragraph's words
  // so proper nouns ("Arun Kumar", "Coimbatore") resolve correctly instead of
  // turning into random guesses.
  const vocab = useMemo(
    () => [...new Set(words.map(normalizeWord).filter(Boolean))],
    [words],
  )

  const { status, pointer, extras } = useMemo(() => {
    const spoken = tokenize(transcript)
    return alignSpoken(spoken, words, { finalize: phase === 'done' })
  }, [transcript, words, phase])

  const correctCount = status.filter((s) => s === 'correct').length
  const missedCount = status.filter(
    (s) => s === 'missed' || s === 'incorrect',
  ).length
  const accuracy =
    words.length > 0 ? Math.round((correctCount / words.length) * 100) : 0

  function begin() {
    if (!text.trim()) return
    setPhase('running')
    start({ grammar: vocab })
  }

  function toggle() {
    if (listening) {
      stop()
      setPhase('done')
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
              : `${micLabel} — ${listening ? 'listening' : phase}`}
          </p>
        )}
      </div>

      <MicButton
        listening={listening}
        disabled={loading || !text.trim()}
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
          </div>

          <div className="reading-text" aria-live="polite">
            {words.map((word, i) => (
              <span key={i}>
                <span
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
