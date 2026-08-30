import { useEffect, useMemo, useState } from 'react'
import { tokenize, alignSpoken } from '../lib/align'
import { speak, initTTS } from '../lib/pocketTTS'

const TWISTERS = ["She sells seashells by the seashore","Peter Piper picked a peck of pickled peppers","Unique New York","Red lorry yellow lorry","Irish wristwatch Swiss wristwatch","Truly rural","Betty Botter bought some butter","Six sticky skeletons"]

export default function Rush({ serverUp, listening, transcript, interim, start, stop, reset }) {
  const [idx, setIdx] = useState(0)
  const [score, setScore] = useState(0)
  const [streak, setStreak] = useState(0)
  const [time, setTime] = useState(60)
  const [playing, setPlaying] = useState(false)
  const target = TWISTERS[idx % TWISTERS.length]
  const words = useMemo(()=>tokenize(target),[target])
  const { status } = useMemo(()=> alignSpoken(tokenize(transcript), words, {finalize: !listening}), [transcript, words, listening])
  const acc = words.length ? Math.round(status.filter(s=>s==='correct').length/words.length*100):0

  useEffect(()=>{ if(!playing) return; const id=setInterval(()=>setTime(t=>{ if(t<=1){ setPlaying(false); stop(); return 0 } return t-1 }),1000); return ()=>clearInterval(id) },[playing])

  function startGame(){ setScore(0); setStreak(0); setTime(60); setIdx(0); setPlaying(true); reset(); start() }
  function next(){
    const s = status.filter(x=>x==='correct').length
    const ok = acc>=75
    setScore(v=> v + s*10*(ok?Math.max(1,streak+1):1))
    setStreak(v=> ok? v+1: 0)
    setIdx(v=>v+1); reset()
  }
  async function preview(){ await initTTS(); await speak(target,{voiceName:'alba'}) }

  // K = next twister, no stop/start needed — mic stays hot
  useEffect(()=>{
    const h=(e)=>{ if(e.key.toLowerCase()!=='k' || !playing) return; e.preventDefault(); next() }
    window.addEventListener('keydown',h); return ()=>window.removeEventListener('keydown',h)
  },[playing, acc, status])

  // auto-start mic and keep it hot throughout the rush
  useEffect(()=>{ if(playing && !listening && serverUp!=='down') start() },[playing, idx])

  return (
    <section className="reading">
      <h2 style={{color:'#f0b232'}}>⚡ Tongue-Twister Rush</h2>
      <div className="reading-stats"><span className="stat-good">{score} pts</span><span className="stat-sep">·</span><span className="stat-dim">streak {streak}×</span><span className="stat-sep">·</span><span className="stat-dim">{time}s</span><span className="stat-sep">·</span><span className="stat-dim">press K → next</span></div>
      {!playing ? <><p className="panel-note">Mic stays hot for 60s — just say it and hit K for next.</p><button className="review" onClick={startGame} disabled={serverUp==='down'}>Start 60s Rush</button></> :
      <>
        <p style={{fontSize:'1.2rem', background:'#1a1d24', border:'1px solid #2b2f3a', borderRadius:12, padding:16, textAlign:'center', width:'100%'}}>{target}</p>
        <div className="actions"><button className="clear" onClick={preview}>🔊 Hear it</button><button className="review" onClick={next}>Next [K] ({acc}%)</button></div>
        <div className="reading-text">{words.map((w,i)=> <span key={i} className={`rw ${status[i]}`}>{w} </span>)}</div>
        <div className="transcript" style={{minHeight:60}}><span className="final">{transcript}</span><span className="interim"> {interim}</span></div>
        <p className="panel-note">{listening?'🎤 listening… press K for next': 'mic paused'}</p>
      </>}
    </section>
  )
}
