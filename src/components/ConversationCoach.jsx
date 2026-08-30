import { useEffect, useMemo, useRef, useState } from 'react'
import MicButton from './MicButton'
import { analyzeFluency, gradeFor } from '../lib/fluency'
import { checkGrammarLocal } from '../lib/grammar'
import { fetchTips } from '../lib/tips'
import { saveSession, addWeakWords } from '../lib/history'

const PROMPTS = [
  { label: 'Everyday', text: 'Describe what you did last weekend, and one thing you wish had gone differently.' },
  { label: 'Opinion', text: 'Argue for or against working from home. Give two reasons you actually believe.' },
  { label: 'Story', text: 'Tell a short story about a time you learned something the hard way.' },
  { label: 'Explain', text: 'Explain how something you use every day works, as if to a curious child.' },
]

function ScoreRing({ score, size = 150, stroke = 13 }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const off = c * (1 - Math.max(0, Math.min(100, score)) / 100)
  const color = score >= 85 ? '#81c995' : score >= 70 ? '#8ab4f8' : score >= 50 ? '#f0b232' : '#ea4335'
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="score-ring">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="#2b2f3a" strokeWidth={stroke} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dashoffset .6s ease' }} />
      <text x="50%" y="46%" textAnchor="middle" className="score-num" fill={color}>{Math.round(score)}</text>
      <text x="50%" y="62%" textAnchor="middle" className="score-grade" fill="#9aa0a6">{gradeFor(score)}</text>
    </svg>
  )
}

export default function ConversationCoach({ serverUp, listening, transcript, interim, error, speakingSeconds, start, stop, reset }) {
  const [prompt, setPrompt] = useState(PROMPTS[0].text)
  const [phase, setPhase] = useState('setup') // setup|you|you_review|ai|scoring|verdict
  const [msgs, setMsgs] = useState([])
  const [draft, setDraft] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [verdict, setVerdict] = useState(null)
  const [tips, setTips] = useState([])
  const [localError, setLocalError] = useState(null)
  const transcriptRef = useRef(''); transcriptRef.current = transcript
  const bottomRef = useRef(null)
  const elapsedRef = useRef(0); elapsedRef.current = elapsed
  const roundRef = useRef(0)

  useEffect(()=> { bottomRef.current?.scrollIntoView({behavior:'smooth'}) }, [msgs, phase, draft])
  useEffect(()=>{ if(phase!=='you' && phase!=='you_review' && phase!=='ai') return; const id=setInterval(()=> setElapsed(s=> s+1),1000); return ()=> clearInterval(id)},[phase])

  function push(role,text){ setMsgs(m=> [...m, {role, text}]) }

  function begin(){
    if(!prompt.trim()) return
    setMsgs([{role:'examiner', text: prompt}]); setDraft(''); setVerdict(null); setTips([]); setLocalError(null)
    setElapsed(0); roundRef.current=0; setPhase('you'); reset()
    setTimeout(()=> start(), 150)
  }

  function stopAndReview(){
    stop()
    setTimeout(()=>{
      const t = transcriptRef.current.trim() || draft.trim()
      if(!t){ setLocalError('Say something first'); return }
      setDraft(t); setPhase('you_review')
    }, 600)
  }
  function rerecord(){ setDraft(''); reset(); setLocalError(null); setPhase('you'); setTimeout(()=> start(), 100) }

  async function sendToBhaskar(){
    const text = draft.trim() || transcriptRef.current.trim()
    if(!text){ setLocalError('Say something first'); return }
    push('you', text); setDraft(''); reset(); setLocalError(null)
    setPhase('ai')
    const history = [...msgs, {role:'you', text}].map(m=> `${m.role==='you'?'You':'Bhaskar'}: ${m.text}`).join('\n')
    let replyText = "Go ahead, I'm listening — what happened?"
    try{
      const res = await fetch('/api/stt/tips', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({text: `Prompt: "${prompt}". Chat so far:\n${history}`, mode:'coach_chat'})})
      const data = await res.json()
      replyText = data.reply?.trim() || replyText
    } catch{
      replyText = "Got it — can you say a little more about that? What part stood out to you?"
    }
    // word-by-word stream
    push('examiner', '')
    const tokens = replyText.split(/(\s+)/)
    let idx = 0
    const tick = () => {
      idx += 2 // word + space chunk
      if(idx > tokens.length) idx = tokens.length
      const partial = tokens.slice(0, idx).join('')
      setMsgs(m => {
        if(m.length===0 || m[m.length-1].role!=='examiner') return m
        const copy = [...m]
        copy[copy.length-1] = {role:'examiner', text: partial}
        return copy
      })
      if(idx >= tokens.length){
        roundRef.current += 1
        setPhase('you')
        setTimeout(()=> { reset(); start() }, 300)
      } else {
        setTimeout(tick, 32)
      }
    }
    tick()
  }

  async function stopAndScore(){
    if(listening) await stop()
    const pending = draft.trim() || transcriptRef.current.trim()
    let allMsgs = [...msgs]
    let youTexts = msgs.filter(m=> m.role==='you').map(m=> m.text)
    if(pending && (phase==='you' || phase==='you_review')){
      if(!msgs[msgs.length-1] || msgs[msgs.length-1].text !== pending){
        allMsgs = [...msgs, {role:'you', text: pending}]
        youTexts = [...youTexts, pending]
        push('you', pending)
      }
      setDraft(''); reset()
    }
    const youText = youTexts.join(' ')
    if(!youText.trim()){ setLocalError('Say something first'); return }
    setPhase('scoring'); setLocalError(null)
    const flu = analyzeFluency(youText, {elapsedSeconds: Math.max(60, elapsedRef.current), speakingSeconds})
    const grammarErrors = checkGrammarLocal(youText)
    try{
      const [sumRes, tipsRes] = await Promise.all([
        fetchTips(`Prompt "${prompt}" chat:\n${allMsgs.map(m=>`${m.role}: ${m.text}`).join('\n')}\nJudge fluency and structure. Provide headline, strengths, improvements, proverbs.`, {mode:'conversation_summary'}),
        fetchTips(youText, {mode:'word_choice'})
      ])
      const summary = sumRes.summary
      const t = tipsRes.tips || []
      setTips(t)
      const wordChoiceScore = Math.max(0, 100 - t.length * 12)
      const grammarScore = Math.max(0, 100 - grammarErrors.length * 15)
      const totalScore = Math.round(flu.score * 0.45 + wordChoiceScore * 0.3 + grammarScore * 0.25)
      const band = (totalScore / 11.11).toFixed(1)
      const points = Math.max(0, Math.round(flu.wordCount*2 + flu.uniqueCount*1.5 + (summary?.strengths?.length||0)*10 - t.length*5 - grammarErrors.length*8))
      const v = { flu, summary, tips: t, grammarErrors, wordChoiceScore, grammarScore, totalScore, band, points }
      setVerdict(v)
      saveSession({ mode:'coach', date:Date.now(), durationSec: elapsedRef.current, fluencyScore: totalScore, rawFluency: flu.score, wpm: flu.wpm, fillerCount: flu.fillerCount, wordCount: flu.wordCount, uniqueCount: flu.uniqueCount, wordChoiceScore, grammarScore, band, points, grammarErrors: grammarErrors.length, tipCount: t.length, llmOk: sumRes.llmOk!==false })
      if(t.length) addWeakWords(t.map(x=> x.phrase))
    } catch{
      const v = { flu, summary: null, tips: [], grammarErrors, wordChoiceScore:100, grammarScore: Math.max(0, 100 - grammarErrors.length*15), totalScore: flu.score, band: (flu.score/11.11).toFixed(1), points: flu.wordCount*2 }
      setVerdict(v)
    }
    setPhase('verdict')
  }

  const isListening = listening && phase==='you'
  const inChat = phase!=='setup' && phase!=='verdict'

  // K = accept (stop and review), Enter = send to Bhaskar — context preserved via history
  const stopRef = useRef(stopAndReview); stopRef.current = stopAndReview
  const sendRef = useRef(sendToBhaskar); sendRef.current = sendToBhaskar
  useEffect(()=>{
    const h = (e)=>{
      const tag = document.activeElement?.tagName
      const isTyping = tag==='TEXTAREA' || tag==='INPUT'
      if(e.key.toLowerCase()==='k' && phase==='you'){
        // K accepts transcript: don't trigger when typing in draft input (review phase is not 'you')
        if(isTyping && phase!=='you') return
        e.preventDefault(); stopRef.current()
      } else if(e.key==='Enter' && phase==='you_review'){
        // Enter sends to Bhaskar (allow editing: Enter in textarea sends)
        if(!draft.trim()) return
        e.preventDefault(); sendRef.current()
      }
    }
    window.addEventListener('keydown', h)
    return ()=> window.removeEventListener('keydown', h)
  }, [phase, draft])

  if(phase==='setup'){
    return (
      <section className="coach coach-setup">
        <h2>Conversation Coach</h2>
        <p className="coach-sub">Pick a prompt and chat with Bhaskar — it keeps going until you stop and get scored.</p>
        <div className="prompt-grid">
          {PROMPTS.map((p) => (
            <button key={p.label} className={`prompt-card ${prompt === p.text ? 'active' : ''}`} onClick={() => setPrompt(p.text)}>
              <span className="prompt-label">{p.label}</span>
              <span className="prompt-text">{p.text}</span>
            </button>
          ))}
        </div>
        <textarea className="paragraph-input" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="…or write your own prompt" />
        <button className="review" onClick={begin} disabled={serverUp==='down' || !prompt.trim()}>Start Chat</button>
        <p className="status">{serverUp==='down' ? 'Speech server offline — start it first.' : 'Bhaskar will ask follow-ups like a real chat'}</p>
        <style>{`.coach-setup { width:100%; max-width:720px; display:flex; flex-direction:column; align-items:center; gap:16px; } .coach-setup h2 { font-size:1.3rem; color:#e8eaed; } .coach-sub { color:#9aa0a6; font-size:.9rem; text-align:center; } .prompt-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:12px; width:100%; } .prompt-card { text-align:left; background:#1a1d24; border:1px solid #2b2f3a; border-radius:12px; padding:14px; cursor:pointer; color:inherit; font:inherit; display:flex; flex-direction:column; gap:6px; } .prompt-card.active { border-color:#8ab4f8; } .prompt-label { font-size:.75rem; text-transform:uppercase; letter-spacing:.05em; color:#8ab4f8; } .prompt-text { font-size:.9rem; color:#cdd1d6; line-height:1.45; } @media (max-width:560px){ .prompt-grid { grid-template-columns:1fr; } }`}</style>
      </section>
    )
  }

  return (
    <div style={{width:'100%', maxWidth:920, display:'flex', gap:14, alignItems:'flex-start'}}>
      <section style={{flex:1, display:'flex', flexDirection:'column', gap:14, minWidth:0}}>
        <div style={{display:'flex', gap:14, alignItems:'flex-start'}}>
          <div style={{flex:1, background:'#1a1d24', border:'1px solid #2b2f3a', borderRadius:12, padding:'14px 16px'}}>
            <span style={{fontSize:11, color:'#8ab4f8', textTransform:'uppercase', letterSpacing:'.05em'}}>Prompt</span>
            <p style={{color:'#e8eaed', fontSize:'.95rem', marginTop:4, lineHeight:1.5}}>{prompt}</p>
          </div>
          <div style={{fontVariantNumeric:'tabular-nums', fontSize:'1.2rem', color:'#8ab4f8', paddingTop:10}}>{String(Math.floor(elapsed/60)).padStart(2,'0')}:{String(elapsed%60).padStart(2,'0')}</div>
        </div>

        <div style={{background:'#12141a', border:'1px solid #2b2f3a', borderRadius:12, padding:12, minHeight:320, maxHeight:420, overflowY:'auto', display:'flex', flexDirection:'column', gap:10}}>
          {msgs.map((m,i)=>
            <div key={i} style={{alignSelf: m.role==='you'?'flex-end':'flex-start', background: m.role==='you'?'#1a2a4a':'#1a1d24', border:'1px solid #2b2f3a', borderRadius:14, padding:'10px 14px', maxWidth:'78%', color:'#e8eaed', fontSize:'.92rem', lineHeight:1.5}}>
              <small style={{color:m.role==='you'?'#8ab4f8':'#9aa0a6', fontSize:11, textTransform:'uppercase'}}>{m.role==='you'?'You':'Bhaskar'}</small><br/>{m.text}
            </div>
          )}
          {(phase==='ai' || phase==='scoring') && <div style={{alignSelf:'flex-start', background:'#1a1d24', border:'1px solid #2b2f3a', borderRadius:14, padding:'10px 14px', color:'#9aa0a6', fontSize:'.9rem'}}>{phase==='ai' ? 'Bhaskar is thinking...' : 'Scoring your chat...'}</div>}
          <div ref={bottomRef} />
        </div>

        {phase==='you' && (
          <div style={{background:'#1a1d24', border:'1px solid #2b2f3a', borderRadius:12, padding:12, minHeight:72}}>
            <small style={{color:'#9aa0a6', fontSize:11}}>Listening — speak now, conversion is live — press K to accept</small>
            <div style={{color:'#e8eaed', marginTop:6, minHeight:24}}><span className="final">{transcript}</span><span className="interim" style={{color:'#9aa0a6'}}> {interim}</span>{isListening && <span className="caret" />}</div>
            <div style={{marginTop:10, display:'flex', gap:8}}><button className="clear" onClick={stopAndReview}>Stop [K]</button><span style={{color: listening?'#81c995':'#9aa0a6', fontSize:12, alignSelf:'center'}}>{listening?'recording':'paused'}</span></div>
          </div>
        )}
        {phase==='you_review' && (
          <div style={{background:'#1a1d24', border:'1px solid #3c414d', borderRadius:12, padding:12, display:'flex', flexDirection:'column', gap:8}}>
            <small style={{color:'#9aa0a6', fontSize:11}}>Review — edit if needed, press Enter to send to Bhaskar</small>
            <textarea className="paragraph-input" rows={3} value={draft} onChange={e=> setDraft(e.target.value)} placeholder="Edit your transcript, then press Enter" />
            <div style={{display:'flex', gap:8, flexWrap:'wrap'}}><button className="clear" onClick={rerecord}>Rerecord</button><button className="review" onClick={sendToBhaskar} disabled={!draft.trim()}>Send to Bhaskar [Enter]</button></div>
          </div>
        )}
        {localError && <p className="grammar-note error" style={{textAlign:'center'}}>{localError}</p>}
        {error && <p className="grammar-note error" style={{textAlign:'center'}}>{error}</p>}

        {phase==='verdict' && verdict && (
          <div style={{background:'#1a1d24', border:'1px solid #2b3a4a', borderRadius:12, padding:18, display:'flex', flexDirection:'column', gap:14}}>
            <div style={{display:'flex', gap:16, alignItems:'center', flexWrap:'wrap'}}>
              <ScoreRing score={verdict.totalScore} />
              <div style={{flex:1}}>
                <div style={{color:'#e8eaed', fontSize:14, fontWeight:600}}>{verdict.points} points · Band {verdict.band}</div>
                <div style={{color:'#9aa0a6', fontSize:12, marginTop:4}}>{verdict.flu.wordCount} words · {verdict.flu.wpm ?? '-'} wpm · {verdict.flu.fillerCount} fillers · {verdict.flu.uniqueCount} unique</div>
                <div style={{display:'flex', gap:8, flexWrap:'wrap', marginTop:6}}>
                  <span style={{background:'#1a2a4a', border:'1px solid #2b3a4a', borderRadius:8, padding:'4px 8px', fontSize:12}}>Fluency {verdict.flu.score}</span>
                  <span style={{background:'#1a2a4a', border:'1px solid #2b3a4a', borderRadius:8, padding:'4px 8px', fontSize:12}}>Word choice {verdict.wordChoiceScore}</span>
                  <span style={{background:'#1a2a4a', border:'1px solid #2b3a4a', borderRadius:8, padding:'4px 8px', fontSize:12}}>Grammar {verdict.grammarScore}</span>
                </div>
                {verdict.summary?.headline && <p style={{color:'#e8eaed', marginTop:8, fontStyle:'italic'}}>{verdict.summary.headline}</p>}
              </div>
            </div>
            {verdict.summary?.strengths?.length>0 && <div><h4 style={{fontSize:11, color:'#81c995', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6}}>Strengths</h4><ul style={{listStyle:'none', display:'flex', flexDirection:'column', gap:6}}>{verdict.summary.strengths.map((s,i)=><li key={i} style={{color:'#cdd1d6', fontSize:'.92rem'}}>· {s}</li>)}</ul></div>}
            {verdict.summary?.improvements?.length>0 && <div><h4 style={{fontSize:11, color:'#f0b232', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6}}>To Improve</h4><ul style={{listStyle:'none', display:'flex', flexDirection:'column', gap:6}}>{verdict.summary.improvements.map((imp,i)=><li key={i} style={{color:'#cdd1d6', fontSize:'.92rem'}}>{imp.area && <span style={{color:'#f0b232', fontWeight:600}}>{imp.area}: </span>}{imp.tip}</li>)}</ul></div>}
            {verdict.tips?.length>0 && <div><h4 style={{fontSize:11, color:'#8ab4f8', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6}}>Word Choice — {verdict.tips.length} issues</h4><ul style={{listStyle:'none', display:'flex', flexDirection:'column', gap:8}}>{verdict.tips.map((t,i)=><li key={i} style={{color:'#cdd1d6', fontSize:'.92rem'}}><span style={{color:'#f0b232', fontWeight:600}}>{t.phrase}</span> → {t.alternatives.join(', ')}<span style={{color:'#9aa0a6'}}> — {t.reason}</span>{t.proverb && <><br/><span style={{color:'#8ab4f8', fontSize:'.85rem'}}>{t.proverb}</span></>}</li>)}</ul></div>}
            {verdict.grammarErrors?.length>0 && <div><h4 style={{fontSize:11, color:'#ea4335', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6}}>Grammar — {verdict.grammarErrors.length} issues</h4><ul style={{listStyle:'none', display:'flex', flexDirection:'column', gap:6}}>{verdict.grammarErrors.map((e,i)=><li key={i} style={{color:'#cdd1d6', fontSize:'.92rem'}}><span style={{color:'#ea4335'}}>{e.message}</span> {e.suggestions?.length ? <span style={{color:'#9aa0a6'}}> — try: {e.suggestions.join(', ')}</span> : null}</li>)}</ul></div>}
            {verdict.summary?.proverbs?.length>0 && <div><h4 style={{fontSize:11, color:'#8ab4f8', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6}}>Proverbs and Idioms</h4><ul style={{listStyle:'none', display:'flex', flexDirection:'column', gap:6}}>{verdict.summary.proverbs.map((p,i)=><li key={i} style={{color:'#cdd1d6', fontSize:'.92rem'}}><span style={{color:'#8ab4f8', fontWeight:600}}>{p.saying}</span> — {p.meaning}{p.example && <><br/><span style={{color:'#9aa0a6', fontSize:'.85rem'}}>e.g. {p.example}</span></>}</li>)}</ul></div>}
            <button className="review" onClick={()=> { setMsgs([]); setVerdict(null); setDraft(''); setPhase('setup')}}>Start New Chat</button>
          </div>
        )}
      </section>
      <div style={{width:160, position:'sticky', top:16, display: inChat ? 'flex' : 'none', flexDirection:'column', gap:8}}>
        <div style={{background:'#1a1d24', border:'1px solid #2b2f3a', borderRadius:12, padding:12}}>
          <div style={{color:'#9aa0a6', fontSize:11, textTransform:'uppercase', letterSpacing:'.05em'}}>Chat</div>
          <div style={{color:'#e8eaed', fontSize:13, marginTop:4}}>{msgs.filter(m=> m.role==='you').length} you · {msgs.filter(m=> m.role==='examiner').length} Bhaskar</div>
          <div style={{marginTop:10, display:'flex', flexDirection:'column', gap:8}}>
            <button className="review" onClick={stopAndScore} disabled={phase==='scoring'} style={{background:'#ea4335', borderColor:'#ea4335', color:'#fff'}}>Stop chat and get score</button>
            <span style={{color:'#9aa0a6', fontSize:11, textAlign:'center'}}>Keeps going until you stop it</span>
          </div>
        </div>
        {verdict && <div style={{background:'#1a1d24', border:'1px solid #2b3a4a', borderRadius:12, padding:12, textAlign:'center'}}><div style={{color:'#9aa0a6', fontSize:11}}>Last score</div><div style={{color: verdict.totalScore>=70 ? '#81c995' : '#f0b232', fontSize:18, fontWeight:700}}>{verdict.totalScore}</div><div style={{color:'#9aa0a6', fontSize:11}}>{verdict.points} pts · Band {verdict.band}</div></div>}
      </div>
    </div>
  )
}
