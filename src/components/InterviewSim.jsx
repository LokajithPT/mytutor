import { useState } from 'react'
import MicButton from './MicButton'
import { fetchTips } from '../lib/tips'
import { initTTS, speak } from '../lib/pocketTTS'
import { analyzeFluency } from '../lib/fluency'

const BANK = [
  "Tell me about yourself.",
  "Why should we hire you?",
  "Describe a challenge you overcame.",
]
export default function InterviewSim({ serverUp, listening, transcript, start, stop, reset }){
  const [qi, setQi] = useState(0)
  const [scores, setScores] = useState([])
  const [phase, setPhase] = useState('setup')
  const [verdict, setVerdict] = useState(null)
  const q = BANK[qi]
  async function ask(){ await initTTS(); await speak(q,{voiceName:'alba'}) }
  function begin(){ setQi(0); setScores([]); setVerdict(null); setPhase('q'); reset(); start() }
  async function next(){
    await stop(); const flu=analyzeFluency(transcript,{elapsedSeconds:60}); const nextScores=[...scores,flu.score]; setScores(nextScores)
    if(qi+1 < BANK.length){ setQi(v=>v+1); reset(); start() } else {
      setPhase('verdict')
      try{ const {summary}=await fetchTips(`Interview answers: "${transcript}". Give headline, strengths, improvements.`,{mode:'conversation_summary'}); setVerdict(summary) }catch{ setVerdict(null)}
    }
  }
  return (
    <section className="reading">
      <h2 style={{color:'#81c995'}}>🎤 Interview Sim</h2>
      {phase==='setup' && <><div style={{background:'#1a1d24',border:'1px solid #2b2f3a',borderRadius:12,padding:16,width:'100%'}}>{BANK.map((x,i)=><p key={i} style={{color:i===qi?'#8ab4f8':'#9aa0a6'}}>{i+1}. {x}</p>)}</div><button className="review" onClick={begin} disabled={serverUp==='down'}>Start Interview</button></>}
      {phase==='q' && <><p style={{background:'#1a1d24',border:'1px solid #8ab4f8',borderRadius:12,padding:14,width:'100%',textAlign:'center'}}>{q}</p><div className="actions"><button className="clear" onClick={ask}>🔊 Hear Q</button><button className="review" onClick={next}>{qi+1===BANK.length?'Finish':'Next Q'}</button></div><MicButton listening={listening} onToggle={()=> listening? next(): start()} /><div className="transcript"><span className="final">{transcript}</span></div><p className="panel-note">Q {qi+1}/{BANK.length} · scores {scores.join(', ')}</p></>}
      {phase==='verdict' && <div className="tips"><h2>Interview Report — Avg {scores.length? Math.round(scores.reduce((a,b)=>a+b,0)/scores.length):0}</h2>{verdict?.headline && <p>“{verdict.headline}”</p>}<button className="review" onClick={()=>setPhase('setup')}>Retry</button></div>}
    </section>
  )
}
