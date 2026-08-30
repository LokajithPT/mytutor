import { useEffect, useRef, useState } from 'react'
import { fetchTips } from '../lib/tips'
import { analyzeFluency, gradeFor } from '../lib/fluency'
import { checkGrammarLocal } from '../lib/grammar'

const MOTIONS = ["Working from home should be banned","AI will replace teachers","Social media does more harm than good"]

export default function Debate({ serverUp, listening, transcript, interim, start, stop, reset }) {
  const [motion, setMotion] = useState(MOTIONS[0])
  const [phase, setPhase] = useState('setup') // setup|you|you_review|ai|scoring|verdict
  const [msgs, setMsgs] = useState([])
  const [draft, setDraft] = useState('')
  const [verdict, setVerdict] = useState(null)
  const [error, setError] = useState(null)
  const [round, setRound] = useState(0)
  const transcriptRef = useRef('')
  const bottomRef = useRef(null)
  transcriptRef.current = transcript
  useEffect(()=> { bottomRef.current?.scrollIntoView({behavior:'smooth'}) }, [msgs, phase, draft])

  function push(role, text){ setMsgs(m=>[...m,{role,text}]) }

  function startDebate(){
    setMsgs([]); setVerdict(null); setError(null); setDraft(''); setRound(0)
    setPhase('you'); reset()
    setTimeout(()=> start(), 100)
  }

  function stopAndReview(){
    stop()
    setTimeout(()=>{
      const t = transcriptRef.current.trim() || draft.trim()
      setDraft(t)
      setPhase('you_review')
    }, 600)
  }

  function rerecord(){
    setDraft(''); reset(); setError(null)
    setPhase('you'); setTimeout(()=> start(), 100)
  }

  async function sendToAI(){
    const text = draft.trim() || transcriptRef.current.trim()
    if(!text) { setError('Say something first'); return }
    push('you', text)
    setDraft(''); reset(); setError(null)
    setPhase('ai')
    const history = [...msgs, {role:'you', text}].map(m=> `${m.role==='you'?'You':'Bhaskar'}: ${m.text}`).join('\n')
    try{
      const res = await fetch('/api/stt/tips', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({text: `Motion: "${motion}". Debate so far:\n${history}`, mode:'debate'})})
      const data = await res.json()
      const aiText = data.reply?.trim() || "Look, I hear you, but I see it differently. Take my team in Pune — we shipped faster remotely because we cut the commute and actually talked with intent. Isn't output what really counts?"
      push('ai', aiText)
    } catch(e){
      push('ai', "Look, I get your point, but I have seen the opposite. My team in Pune shipped faster remotely — we cut the commute and met with intent. Should we not judge by results?")
    }
    setRound(r=> r+1)
    setPhase('you')
    setTimeout(()=> { reset(); start() }, 300)
  }

  async function stopAndScore(){
    if(listening) await stop()
    const pending = draft.trim() || transcriptRef.current.trim()
    let allMsgs = [...msgs]
    let youTextsForScoring = msgs.filter(m=> m.role==='you').map(m=> m.text)
    if(pending && phase!=='scoring' && phase!=='verdict' && phase!=='ai'){
      // include pending as final you message if in review or listening
      if(phase==='you' || phase==='you_review'){
        allMsgs = [...msgs, {role:'you', text: pending}]
        youTextsForScoring = [...youTextsForScoring, pending]
        // push for visibility if not already visible
        if(phase==='you' || phase==='you_review'){
          // avoid double push if already counted - check last msg
          const last = msgs[msgs.length-1]
          if(!last || last.text !== pending){
            push('you', pending)
          }
          setDraft(''); reset()
        }
      }
    }
    const allText = allMsgs.map(m=>m.text).join(' ')
    const youText = youTextsForScoring.join(' ')
    if(!youText.trim()){ setError('Debate is empty — say something first'); return }
    setPhase('scoring'); setError(null)
    const flu = analyzeFluency(youText, {elapsedSeconds: Math.max(60, youTextsForScoring.length * 30)})
    const grammarErrors = checkGrammarLocal(youText)
    // points: fluency + word choice + grammar
    // we will fetch both summary and word_choice in parallel
    try{
      const [sumRes, tipsRes] = await Promise.all([
        fetchTips(`Motion "${motion}" full debate transcript (only You is being scored):\n${allMsgs.map(m=>`${m.role}: ${m.text}`).join('\n')}\nJudge only Your performance. Provide headline, strengths, improvements, and relevant proverbs.`, {mode:'conversation_summary'}),
        fetchTips(youText, {mode:'word_choice'})
      ])
      const summary = sumRes.summary
      const tips = tipsRes.tips || []
      // word choice score: 100 - 10 per tip, floor 0
      const wordChoiceScore = Math.max(0, 100 - tips.length * 12)
      const grammarScore = Math.max(0, 100 - grammarErrors.length * 15)
      const totalScore = Math.round((flu.score * 0.5 + wordChoiceScore * 0.3 + grammarScore * 0.2))
      const points = Math.round(flu.wordCount * 2 + flu.uniqueCount * 1.5 + (summary?.strengths?.length||0)*10 - tips.length *5 - grammarErrors.length*8)
      setVerdict({ flu, summary, tips, grammarErrors, wordChoiceScore, grammarScore, totalScore, points: Math.max(0, points), round })
    } catch{
      const wordChoiceScore = 100
      const grammarScore = Math.max(0, 100 - grammarErrors.length * 15)
      const totalScore = Math.round((flu.score * 0.6 + grammarScore * 0.4))
      setVerdict({ flu, summary: null, tips: [], grammarErrors, wordChoiceScore, grammarScore, totalScore, points: Math.max(0, flu.wordCount *2), round })
    }
    setPhase('verdict')
  }

  const isListening = listening && phase==='you'
  const inDebate = phase!=='setup' && phase!=='verdict'
  const canStop = msgs.length>0 || draft.trim() || transcript.trim()

  return (
    <div style={{width:'100%', maxWidth:920, display:'flex', gap:14, alignItems:'flex-start'}}>
      <section style={{flex:1, display:'flex', flexDirection:'column', gap:14, minWidth:0}}>
        <h2 style={{color:'#e8eaed', textAlign:'center', fontWeight:600}}>Debate Arena</h2>
        <div className="presets">
          {MOTIONS.map(m=> <button key={m} className={`preset ${motion===m?'active':''}`} onClick={()=> phase==='setup' && setMotion(m)}>{m.slice(0,28)}</button>)}
        </div>
        <textarea className="paragraph-input" rows={2} value={motion} onChange={e=>setMotion(e.target.value)} disabled={phase!=='setup'} placeholder="Enter debate motion" />

        <div style={{background:'#12141a', border:'1px solid #2b2f3a', borderRadius:12, padding:12, minHeight:300, maxHeight:420, overflowY:'auto', display:'flex', flexDirection:'column', gap:10}}>
          {msgs.length===0 && phase==='setup' && <p className="panel-note" style={{textAlign:'center'}}>Pick a motion and start. You will speak, review the transcript, then send. Debate keeps going until you stop it.</p>}
          {msgs.map((m,i)=>
            <div key={i} style={{alignSelf: m.role==='you'?'flex-end':'flex-start', background: m.role==='you'?'#1a2a4a':'#1a1d24', border:'1px solid #2b2f3a', borderRadius:14, padding:'10px 14px', maxWidth:'78%', color:'#e8eaed', fontSize:'.92rem', lineHeight:1.5}}>
              <small style={{color:m.role==='you'?'#8ab4f8':'#9aa0a6', fontSize:11, textTransform:'uppercase'}}>{m.role==='you'?'You':'Bhaskar'}</small><br/>{m.text}
            </div>
          )}
          {(phase==='ai' || phase==='scoring') && <div style={{alignSelf:'flex-start', background:'#1a1d24', border:'1px solid #2b2f3a', borderRadius:14, padding:'10px 14px', color:'#9aa0a6', fontSize:'.9rem'}}>{phase==='ai' ? 'Bhaskar is thinking...' : 'Scoring your debate...'}</div>}
          <div ref={bottomRef} />
        </div>

        {(phase==='you') && (
          <div style={{background:'#1a1d24', border:'1px solid #2b2f3a', borderRadius:12, padding:12, minHeight:72}}>
            <small style={{color:'#9aa0a6', fontSize:11}}>Listening — speak now, conversion is live</small>
            <div style={{color:'#e8eaed', marginTop:6, minHeight:24}}><span className="final">{transcript}</span><span className="interim" style={{color:'#9aa0a6'}}> {interim}</span>{isListening && <span className="caret" />}</div>
            <div style={{marginTop:10, display:'flex', gap:8}}>
              <button className="clear" onClick={stopAndReview}>Stop</button>
              <span style={{color: listening?'#81c995':'#9aa0a6', fontSize:12, alignSelf:'center'}}>{listening?'recording':'paused'}</span>
            </div>
          </div>
        )}

        {(phase==='you_review') && (
          <div style={{background:'#1a1d24', border:'1px solid #3c414d', borderRadius:12, padding:12, display:'flex', flexDirection:'column', gap:8}}>
            <small style={{color:'#9aa0a6', fontSize:11}}>Review your transcript — edit if needed before sending</small>
            <textarea className="paragraph-input" rows={3} value={draft} onChange={e=> setDraft(e.target.value)} placeholder="Your speech will appear here. Edit before sending." />
            <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
              <button className="clear" onClick={rerecord}>Rerecord</button>
              <button className="review" onClick={sendToAI} disabled={!draft.trim()}>Send to Bhaskar</button>
            </div>
          </div>
        )}

        <div className="actions" style={{justifyContent:'center', flexWrap:'wrap'}}>
          {phase==='setup' && <button className="review" onClick={startDebate} disabled={serverUp==='down'}>Start Debate</button>}
          {phase==='ai' && <span className="panel-note">Bhaskar replied — your turn again</span>}
        </div>

        {error && <p className="grammar-note error" style={{textAlign:'center'}}>{error}</p>}

        {phase==='verdict' && verdict && (
          <div style={{background:'#1a1d24', border:'1px solid #2b3a4a', borderRadius:12, padding:18, display:'flex', flexDirection:'column', gap:14}}>
            <div style={{display:'flex', gap:16, alignItems:'center', flexWrap:'wrap'}}>
              <div style={{width:110, height:110, borderRadius:'50%', border:'4px solid #2b2f3a', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center'}}>
                <span style={{fontSize:'1.6rem', fontWeight:700, color: verdict.totalScore>=70 ? '#81c995' : verdict.totalScore>=50 ? '#f0b232' : '#ea4335'}}>{verdict.totalScore}</span>
                <small style={{color:'#9aa0a6', fontSize:11}}>{gradeFor(verdict.totalScore)}</small>
              </div>
              <div style={{flex:1}}>
                <div style={{color:'#e8eaed', fontSize:14, fontWeight:600}}>{verdict.points} points</div>
                <div style={{color:'#9aa0a6', fontSize:12, marginTop:4}}>{verdict.flu.wordCount} words · {verdict.flu.wpm ?? '-'} wpm · {verdict.flu.fillerCount} fillers · {verdict.round+1} rounds</div>
                <div style={{color:'#9aa0a6', fontSize:12, marginTop:6, display:'flex', gap:8, flexWrap:'wrap'}}>
                  <span style={{background:'#1a2a4a', border:'1px solid #2b3a4a', borderRadius:8, padding:'4px 8px'}}>Fluency {verdict.flu.score}</span>
                  <span style={{background:'#1a2a4a', border:'1px solid #2b3a4a', borderRadius:8, padding:'4px 8px'}}>Word choice {verdict.wordChoiceScore}</span>
                  <span style={{background:'#1a2a4a', border:'1px solid #2b3a4a', borderRadius:8, padding:'4px 8px'}}>Grammar {verdict.grammarScore}</span>
                </div>
                {verdict.summary?.headline && <p style={{color:'#e8eaed', marginTop:8, fontStyle:'italic'}}>{verdict.summary.headline}</p>}
              </div>
            </div>

            {verdict.summary?.strengths?.length>0 && (
              <div>
                <h4 style={{fontSize:11, color:'#81c995', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6}}>Strengths</h4>
                <ul style={{listStyle:'none', display:'flex', flexDirection:'column', gap:6}}>
                  {verdict.summary.strengths.map((s,i)=><li key={i} style={{color:'#cdd1d6', fontSize:'.92rem'}}>· {s}</li>)}
                </ul>
              </div>
            )}
            {verdict.summary?.improvements?.length>0 && (
              <div>
                <h4 style={{fontSize:11, color:'#f0b232', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6}}>To Improve</h4>
                <ul style={{listStyle:'none', display:'flex', flexDirection:'column', gap:6}}>
                  {verdict.summary.improvements.map((imp,i)=><li key={i} style={{color:'#cdd1d6', fontSize:'.92rem'}}>{imp.area && <span style={{color:'#f0b232', fontWeight:600}}>{imp.area}: </span>}{imp.tip}</li>)}
                </ul>
              </div>
            )}
            {verdict.tips?.length>0 && (
              <div>
                <h4 style={{fontSize:11, color:'#8ab4f8', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6}}>Word Choice — {verdict.tips.length} issues</h4>
                <ul style={{listStyle:'none', display:'flex', flexDirection:'column', gap:8}}>
                  {verdict.tips.map((t,i)=><li key={i} style={{color:'#cdd1d6', fontSize:'.92rem'}}><span style={{color:'#f0b232', fontWeight:600}}>{t.phrase}</span> → {t.alternatives.join(', ')}<span style={{color:'#9aa0a6'}}> — {t.reason}</span>{t.proverb && <><br/><span style={{color:'#8ab4f8', fontSize:'.85rem'}}>{t.proverb}</span></>}</li>)}
                </ul>
              </div>
            )}
            {verdict.grammarErrors?.length>0 && (
              <div>
                <h4 style={{fontSize:11, color:'#ea4335', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6}}>Grammar Errors — {verdict.grammarErrors.length}</h4>
                <ul style={{listStyle:'none', display:'flex', flexDirection:'column', gap:6}}>
                  {verdict.grammarErrors.map((e,i)=><li key={i} style={{color:'#cdd1d6', fontSize:'.92rem'}}><span style={{color:'#ea4335'}}>{e.message}</span> {e.suggestions?.length ? <span style={{color:'#9aa0a6'}}> — try: {e.suggestions.join(', ')}</span> : null}</li>)}
                </ul>
              </div>
            )}
            {verdict.summary?.proverbs?.length>0 && (
              <div>
                <h4 style={{fontSize:11, color:'#8ab4f8', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6}}>Proverbs and Idioms</h4>
                <ul style={{listStyle:'none', display:'flex', flexDirection:'column', gap:6}}>
                  {verdict.summary.proverbs.map((p,i)=><li key={i} style={{color:'#cdd1d6', fontSize:'.92rem'}}><span style={{color:'#8ab4f8', fontWeight:600}}>{p.saying}</span> — {p.meaning}{p.example && <><br/><span style={{color:'#9aa0a6', fontSize:'.85rem'}}>e.g. {p.example}</span></>}</li>)}
                </ul>
              </div>
            )}
            <div>
              <h4 style={{fontSize:11, color:'#9aa0a6', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6}}>Points Breakdown</h4>
              <p style={{color:'#9aa0a6', fontSize:12, lineHeight:1.6}}>Points = words×2 + unique×1.5 + strengths×10 − word issues×5 − grammar×8. Fluency 50%, word choice 30%, grammar 20% for total score.</p>
            </div>
            <button className="review" onClick={()=>{setMsgs([]); setVerdict(null); setDraft(''); setPhase('setup'); setRound(0)}}>Start New Debate</button>
          </div>
        )}

        <p className="panel-note" style={{textAlign:'center', fontSize:12}}>
          {phase==='you' && 'Speak, then press Stop to review'}
          {phase==='you_review' && 'Edit or rerecord, then send to Bhaskar'}
          {phase==='ai' && 'Bhaskar replied — your turn again, debate keeps going'}
          {phase==='scoring' && 'Analysing your debate...'}
        </p>
      </section>

      <div style={{width:160, position:'sticky', top:16, display: inDebate ? 'flex' : 'none', flexDirection:'column', gap:8}}>
        <div style={{background:'#1a1d24', border:'1px solid #2b2f3a', borderRadius:12, padding:12}}>
          <div style={{color:'#9aa0a6', fontSize:11, textTransform:'uppercase', letterSpacing:'.05em'}}>Debate</div>
          <div style={{color:'#e8eaed', fontSize:13, marginTop:4}}>Round {round+1}</div>
          <div style={{color:'#9aa0a6', fontSize:11, marginTop:2}}>{msgs.filter(m=>m.role==='you').length} you · {msgs.filter(m=>m.role==='ai').length} Bhaskar</div>
          <div style={{marginTop:10, display:'flex', flexDirection:'column', gap:8}}>
            <button className="review" onClick={stopAndScore} disabled={!canStop || phase==='scoring'} style={{background: canStop ? '#ea4335' : undefined, borderColor: canStop ? '#ea4335' : undefined, color: canStop ? '#fff' : undefined}}>Stop debate and get score</button>
            <span style={{color:'#9aa0a6', fontSize:11, textAlign:'center'}}>Keeps going until you stop it</span>
          </div>
        </div>
        {verdict && <div style={{background:'#1a1d24', border:'1px solid #2b3a4a', borderRadius:12, padding:12, textAlign:'center'}}><div style={{color:'#9aa0a6', fontSize:11}}>Last score</div><div style={{color: verdict.totalScore>=70 ? '#81c995' : '#f0b232', fontSize:18, fontWeight:700}}>{verdict.totalScore}</div><div style={{color:'#9aa0a6', fontSize:11}}>{verdict.points} pts</div></div>}
      </div>
    </div>
  )
}
