import { useEffect, useRef, useState } from 'react'
import { fetchTips } from '../lib/tips'
import { initTTS, speak, stopTTS } from '../lib/pocketTTS'
import { analyzeFluency } from '../lib/fluency'

const MOTIONS = ["Working from home should be banned","AI will replace teachers","Social media does more harm than good"]

export default function Debate({ serverUp, listening, transcript, interim, start, stop, reset }) {
  const [motion, setMotion] = useState(MOTIONS[0])
  const [phase, setPhase] = useState('setup') // setup|you|ai|rebuttal|verdict
  const [msgs, setMsgs] = useState([]) // {role:'you'|'ai', text}
  const [loading, setLoading] = useState(false)
  const [verdict, setVerdict] = useState(null)
  const [ttsErr, setTtsErr] = useState(null)
  const transcriptRef = useRef(''); transcriptRef.current = transcript
  const bottomRef = useRef(null)
  useEffect(()=> bottomRef.current?.scrollIntoView({behavior:'smooth'}), [msgs, loading])

  function push(role,text){ setMsgs(m=>[...m,{role,text}]) }

  async function startDebate(){ setMsgs([]); setVerdict(null); setPhase('you'); reset(); start() }
  async function handleK(){
    if(phase==='you'){
      const youText = transcriptRef.current.trim(); if(!youText) return
      push('you', youText); await stop(); reset()
      setPhase('ai'); setLoading(true); setTtsErr(null)
      let txt="I disagree. Remote work builds trust and output over attendance. Freedom fuels focus; measure results, not chairs."
      try{
        const { summary } = await fetchTips(`Motion: "${motion}". User argued: "${youText}". Give a concise counter-argument 60-80 words, opposite stance, punchy.`, {mode:'conversation_summary'})
        if(summary?.headline) txt = summary.headline + (summary.improvements?.[0]?.tip ? ' ' + summary.improvements[0].tip : '')
        push('ai', txt)
      }catch{ push('ai',txt) }
      try{ await initTTS(); await speak(txt,{voiceName:'alba'}) }catch(e){ setTtsErr(e.message) }
      setLoading(false); setPhase('rebuttal'); start()
    } else if(phase==='rebuttal'){
      const rebut = transcriptRef.current.trim(); if(!rebut) return
      push('you', rebut); await stop(); setLoading(true)
      const flu = analyzeFluency(msgs.map(m=>m.text).join(' ')+' '+rebut,{elapsedSeconds:120})
      try{
        const { summary } = await fetchTips(`Motion "${motion}" debate:\n${msgs.map(m=>m.role+': '+m.text).join('\n')}\nYou: ${rebut}\nJudge it: headline, strengths, improvements.`, {mode:'conversation_summary'})
        setVerdict({ flu, summary })
      }catch{ setVerdict({ flu, summary:null }) }
      setLoading(false); setPhase('verdict'); reset()
    } else if(phase==='setup'){ startDebate() }
  }

  const handleKRef = useRef(handleK); handleKRef.current = handleK
  useEffect(()=>{
    const h=(e)=>{ if(e.key.toLowerCase()!=='k') return; if(['setup','you','rebuttal'].includes(phase)){ e.preventDefault(); handleKRef.current() } }
    window.addEventListener('keydown',h); return ()=>window.removeEventListener('keydown',h)
  },[phase])

  return (
    <section style={{width:'100%',maxWidth:720, display:'flex', flexDirection:'column', gap:14}}>
      <h2 style={{color:'#8ab4f8', textAlign:'center'}}>⚔️ Debate Arena <span style={{color:'#9aa0a6',fontSize:12, fontWeight:400}}>— press K to send</span></h2>
      <div className="presets">{MOTIONS.map(m=> <button key={m} className={`preset ${motion===m?'active':''}`} onClick={()=>setMotion(m)}>{m.slice(0,24)}</button>)}</div>
      <textarea className="paragraph-input" rows={2} value={motion} onChange={e=>setMotion(e.target.value)} disabled={phase!=='setup'} />

      {/* chat */}
      <div style={{background:'#12141a', border:'1px solid #2b2f3a', borderRadius:12, padding:12, minHeight:260, maxHeight:380, overflowY:'auto', display:'flex', flexDirection:'column', gap:10}}>
        {msgs.length===0 && phase==='setup' && <p className="panel-note" style={{textAlign:'center'}}>Pick a motion, hit K to start — mic stays hot, K sends each turn.</p>}
        {msgs.map((m,i)=>
          <div key={i} style={{alignSelf: m.role==='you'?'flex-end':'flex-start', background: m.role==='you'?'#1a2a4a':'#1a1d24', border:'1px solid #2b2f3a', borderRadius:14, padding:'10px 14px', maxWidth:'78%', color:'#e8eaed', fontSize:'.92rem', lineHeight:1.5}}>
            <small style={{color:m.role==='you'?'#8ab4f8':'#f0b232', fontSize:11}}>{m.role==='you'?'You':'AI'}</small><br/>{m.text}
          </div>
        )}
        {loading && <div style={{alignSelf:'flex-start', background:'#1a1d24', border:'1px solid #2b2f3a', borderRadius:14, padding:'10px 14px', color:'#9aa0a6'}}>AI thinking…</div>}
        <div ref={bottomRef} />
      </div>

      {(phase==='you'||phase==='rebuttal') && <div className="transcript" style={{minHeight:70}}><span className="final">{transcript}</span><span className="interim"> {interim}</span><span style={{color: listening?'#81c995':'#ea4335', fontSize:11, marginLeft:8}}>{listening?'● live':'○ paused'}</span></div>}

      <div className="actions" style={{justifyContent:'center'}}>
        {phase==='setup' && <button className="review" onClick={startDebate} disabled={serverUp==='down'}>Start [K]</button>}
        {phase==='you' && <button className="review" onClick={handleK} disabled={!transcript.trim()}>Send to AI [K]</button>}
        {phase==='rebuttal' && <button className="review" onClick={handleK} disabled={!transcript.trim()}>Send rebuttal [K]</button>}
        {phase==='ai' && <button className="clear" onClick={()=>stopTTS()}>Stop TTS</button>}
        {phase==='verdict' && verdict && <div className="tips" style={{width:'100%'}}><h2>Verdict — {verdict.flu.score}/100</h2>{verdict.summary?.headline && <p>“{verdict.summary.headline}”</p>}<button className="review" onClick={()=>{setMsgs([]); setVerdict(null); setPhase('setup')}}>Again</button></div>}
      </div>
      {ttsErr && <p className="grammar-note error">TTS: {ttsErr} (using browser voice fallback)</p>}
      <p className="panel-note" style={{textAlign:'center'}}>{phase==='you'?'Your turn — argue, then press K': phase==='rebuttal'?'AI replied above — now rebut and press K': phase==='ai'?'AI speaking…':''}</p>
    </section>
  )
}
