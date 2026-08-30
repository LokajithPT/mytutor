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
  const [level, setLevel] = useState(5)
  const [wordCount, setWordCount] = useState(50)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState(null)
  const textBoxRef = useRef(null)

  async function generate(){
    setGenerating(true); setGenError(null)
    try{
      const res = await fetch('/api/stt/tips', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({text: String(level), level, words: wordCount, mode:'reading_generate'})})
      const data = await res.json()
      if(data.paragraph){ setText(data.paragraph); setPhase('setup') }
      else if(data.llm_ok===false) throw new Error(data.error || 'LLM not reachable')
      else throw new Error('Empty generation')
    } catch(e){
      setGenError(e.message || 'Generation failed')
    } finally{ setGenerating(false) }
  }

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

  const levelLabel = level<=3 ? 'Easy' : level<=5 ? 'Medium' : level<=7 ? 'Hard' : level<=9 ? 'Very Hard' : 'Expert'
  return (
    <section className="reading">
      <div className="reading-head">
        {phase === 'setup' ? (
          <>
            <div style={{background:'#1a1d24', border:'1px solid #2b2f3a', borderRadius:12, padding:12, display:'flex', flexDirection:'column', gap:10}}>
              <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
                <span style={{color:'#9aa0a6', fontSize:12, minWidth:70}}>Level {level} — {levelLabel}</span>
                <input type="range" min="1" max="10" value={level} onChange={e=> setLevel(parseInt(e.target.value))} style={{flex:1, accentColor:'#8ab4f8'}} />
                <button className="review" onClick={generate} disabled={generating} style={{whiteSpace:'nowrap'}}>{generating ? 'Generating...' : `Generate`}</button>
              </div>
              <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
                {[1,2,3,4,5,6,7,8,9,10].map(n=> <button key={n} onClick={()=> setLevel(n)} style={{width:32, height:32, borderRadius:8, border: level===n ? '1px solid #8ab4f8' : '1px solid #2b2f3a', background: level===n ? '#1a2a4a' : 'transparent', color: level===n ? '#8ab4f8' : '#9aa0a6', cursor:'pointer', fontSize:12}}>{n}</button>)}
              </div>
              <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap'}}>
                <span style={{color:'#9aa0a6', fontSize:12}}>Words:</span>
                {[10,25,50,75,100,150].map(n=> <button key={n} onClick={()=> setWordCount(n)} style={{padding:'6px 10px', borderRadius:8, border: wordCount===n ? '1px solid #8ab4f8' : '1px solid #2b2f3a', background: wordCount===n ? '#1a2a4a' : 'transparent', color: wordCount===n ? '#8ab4f8' : '#9aa0a6', cursor:'pointer', fontSize:12}}>{n}</button>)}
                <input type="number" min="10" max="200" value={wordCount} onChange={e=> setWordCount(Math.max(10, Math.min(200, parseInt(e.target.value)||10)))} style={{width:70, background:'#12141a', border:'1px solid #2b2f3a', borderRadius:8, color:'#e8eaed', padding:'6px 8px', fontSize:12}} />
                <span style={{color:'#5f6368', fontSize:11}}>10-200</span>
              </div>
              {genError && <p className="grammar-note error">{genError} — try again or paste manually. Needs NIM.</p>}
            </div>
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
              placeholder="Paste a paragraph to read… or generate one above"
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
