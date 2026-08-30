import { useEffect, useMemo, useRef, useState } from 'react'
import MicButton from './MicButton'
import { tokenize, alignSpoken } from '../lib/align'
import { initTTS, speak, stopTTS } from '../lib/pocketTTS'

const SENTENCES = [
  "The quick brown fox jumps over the lazy dog.",
  "She sells seashells by the seashore.",
  "Practice makes perfect when you speak every day.",
  "Confidence grows when you try again and again.",
  "A journey of a thousand miles begins with a single step.",
]

export default function ShadowDojo({ serverUp, listening, transcript, interim, start, stop, reset }) {
  const [text, setText] = useState(SENTENCES[0])
  const [ttsState, setTtsState] = useState('idle')
  const [ttsProgress, setTtsProgress] = useState('')
  const [ttsErr, setTtsErr] = useState(null)
  const [ghostPlayed, setGhostPlayed] = useState(false)
  useEffect(()=>{
    setTtsState('loading'); setTtsProgress('Downloading voice… 0%')
    initTTS({onProgress:(p)=> setTtsProgress(`${p.type||'downloading'} ${p.total?Math.round((p.loaded/p.total)*100):0}%`)}).then(()=>{setTtsState('ready'); setTtsProgress('Voice ready ✓')}).catch(e=>{ console.warn('PocketTTS unavailable, using browser voice',e); setTtsState('ready'); setTtsProgress('Using browser voice (PocketTTS failed: '+e.message+')'); })
  },[])
  const words = useMemo(()=> tokenize(text), [text])
  const { status, pointer } = useMemo(()=>{
    const spoken = tokenize(transcript)
    return alignSpoken(spoken, words, { finalize: !listening && ghostPlayed })
  },[transcript, words, listening, ghostPlayed])
  const accuracy = words.length ? Math.round(status.filter(s=>s==='correct').length/words.length*100) : 0

  async function playGhost(){
    try { await speak(text, {voiceName:'alba'}); setGhostPlayed(true) } catch(e) { setTtsState('error'); setTtsErr(e.message) }
  }
  function begin(){ reset(); setGhostPlayed(false); start() }
  function toggle(){ if(listening) stop(); else begin() }

  return (
    <section className="reading">
      <h2 style={{color:'#8ab4f8'}}>👻 Shadow Dojo — Ghost</h2>
      <p className="panel-note">Listen to the ghost, then shadow it — words light up as you match timing.</p>
      <div className="presets">{SENTENCES.map(s=> <button key={s} className={`preset ${text===s?'active':''}`} onClick={()=>setText(s)}>{s.slice(0,22)}…</button>)}</div>
      <textarea className="paragraph-input" rows={2} value={text} onChange={e=>setText(e.target.value)} />
      <div className="actions">
        <button className="review" onClick={playGhost} disabled={ttsState==='loading'}>{ttsState==='loading'?'⏳ '+ttsProgress:'🔊 Play Ghost'}</button>
        <button className="clear" onClick={()=>stopTTS()}>Stop ghost</button>
      </div>
      {ttsState==='loading' && <p className="grammar-note">{ttsProgress} — first time ~50MB, then cached offline.</p>}
      {ttsState==='error' && <p className="grammar-note error">TTS failed: {ttsErr}</p>}
      <MicButton listening={listening} disabled={serverUp==='down'||!text.trim()} onToggle={toggle} />
      <div className="reading-stats"><span className={accuracy>=80?'stat-good':'stat-bad'}>{accuracy}%</span><span className="stat-dim"> {status.filter(s=>s==='correct').length}/{words.length}</span></div>
      <div className="reading-text">{words.map((w,i)=> <span key={i} className={`rw ${status[i]} ${i===pointer&&listening?'current':''}`}>{w} </span>)}</div>
      {interim && <p className="interim-line">{interim}</p>}
      <p className="panel-note">Tip: play ghost first, then hit mic and shadow immediately.</p>
    </section>
  )
}
