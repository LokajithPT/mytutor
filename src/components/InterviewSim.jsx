import { useEffect, useRef, useState } from 'react'
import { fetchTips } from '../lib/tips'
import { analyzeFluency, gradeFor } from '../lib/fluency'
import { checkGrammarLocal } from '../lib/grammar'

const IELTS_BANK = [
  "Tell me about yourself and where you come from.",
  "Describe a place you like to visit in your free time.",
  "Talk about a person who has inspired you a lot.",
  "Describe a difficult decision you had to make.",
  "What are your future goals and how will you achieve them?",
  "Do you prefer working alone or in a team? Why?",
  "Describe a skill you want to learn and why.",
  "Talk about a time you helped someone.",
]

export default function InterviewSim({ serverUp, listening, transcript, interim, start, stop, reset }){
  const [phase, setPhase] = useState('setup') // setup|you|you_review|ai|scoring|verdict
  const [msgs, setMsgs] = useState([]) // {role:'examiner'|'you', text}
  const [draft, setDraft] = useState('')
  const [verdict, setVerdict] = useState(null)
  const [error, setError] = useState(null)
  const [round, setRound] = useState(0)
  const [currentQ, setCurrentQ] = useState(IELTS_BANK[0])
  const transcriptRef = useRef('')
  const bottomRef = useRef(null)
  transcriptRef.current = transcript
  useEffect(()=> { bottomRef.current?.scrollIntoView({behavior:'smooth'}) }, [msgs, phase, draft])

  function push(role,text){ setMsgs(m=> [...m, {role, text}]) }

  async function startInterview(){
    const q = IELTS_BANK[Math.floor(Math.random()*IELTS_BANK.length)]
    setCurrentQ(q); setMsgs([{role:'examiner', text: q}]); setVerdict(null); setError(null); setDraft(''); setRound(0)
    setPhase('you'); reset()
    setTimeout(()=> start(), 150)
  }

  function stopAndReview(){
    stop()
    setTimeout(()=>{
      const t = transcriptRef.current.trim() || draft.trim()
      setDraft(t)
      setPhase('you_review')
    }, 600)
  }
  function rerecord(){ setDraft(''); reset(); setError(null); setPhase('you'); setTimeout(()=> start(), 100) }

  async function sendAnswer(){
    const text = draft.trim() || transcriptRef.current.trim()
    if(!text){ setError('Say something first'); return }
    push('you', text)
    setDraft(''); reset(); setError(null)
    // Bhaskar as IELTS examiner gives next question
    setPhase('ai')
    const history = [...msgs, {role:'you', text}].map(m=> `${m.role==='you'?'Candidate':'Examiner'}: ${m.text}`).join('\n')
    try{
      const res = await fetch('/api/stt/tips', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({text: `You are Bhaskar, an IELTS examiner. Interview history:\n${history}\nGive the next IELTS-style follow-up question (one sentence, conversational, no scoring). Keep it natural like a real examiner.`, mode:'debate'})})
      const data = await res.json()
      const q = data.reply?.trim() || IELTS_BANK[(round+1) % IELTS_BANK.length]
      setCurrentQ(q)
      push('examiner', q)
    } catch{
      const q = IELTS_BANK[(round+1) % IELTS_BANK.length]
      setCurrentQ(q); push('examiner', q)
    }
    setRound(r=> r+1)
    setPhase('you')
    setTimeout(()=> { reset(); start() }, 300)
  }

  async function stopAndScore(){
    if(listening) await stop()
    const pending = draft.trim() || transcriptRef.current.trim()
    let allMsgs = [...msgs]
    let youTexts = msgs.filter(m=> m.role==='you').map(m=> m.text)
    if(pending && phase!=='scoring' && phase!=='verdict' && phase!=='ai'){
      if(phase==='you' || phase==='you_review'){
        if(!msgs[msgs.length-1] || msgs[msgs.length-1].text !== pending){
          allMsgs = [...msgs, {role:'you', text: pending}]
          youTexts = [...youTexts, pending]
          push('you', pending)
        }
        setDraft(''); reset()
      }
    }
    const youText = youTexts.join(' ')
    if(!youText.trim()){ setError('Answer something first'); return }
    setPhase('scoring'); setError(null)
    const flu = analyzeFluency(youText, {elapsedSeconds: Math.max(60, youTexts.length * 35)})
    const grammarErrors = checkGrammarLocal(youText)
    try{
      const [sumRes, tipsRes] = await Promise.all([
        fetchTips(`IELTS interview transcript (score only the Candidate):\n${allMsgs.map(m=>`${m.role}: ${m.text}`).join('\n')}\nJudge fluency, coherence, lexical resource, grammar. Provide headline, strengths, improvements, and relevant proverbs/idioms.`, {mode:'conversation_summary'}),
        fetchTips(youText, {mode:'word_choice'})
      ])
      const summary = sumRes.summary
      const tips = tipsRes.tips || []
      const wordChoiceScore = Math.max(0, 100 - tips.length * 12)
      const grammarScore = Math.max(0, 100 - grammarErrors.length * 15)
      const totalScore = Math.round((flu.score * 0.45 + wordChoiceScore * 0.3 + grammarScore * 0.25))
      // IELTS band 0-9 approx: totalScore/11.11
      const band = (totalScore / 11.11).toFixed(1)
      const points = Math.max(0, Math.round(flu.wordCount*2 + flu.uniqueCount*1.5 + (summary?.strengths?.length||0)*10 - tips.length*5 - grammarErrors.length*8))
      setVerdict({ flu, summary, tips, grammarErrors, wordChoiceScore, grammarScore, totalScore, band, points, round })
    } catch{
      setVerdict({ flu, summary: null, tips: [], grammarErrors, wordChoiceScore:100, grammarScore: Math.max(0, 100 - grammarErrors.length*15), totalScore: flu.score, band: (flu.score/11.11).toFixed(1), points: flu.wordCount*2, round })
    }
    setPhase('verdict')
  }

  const isListening = listening && phase==='you'
  const inInterview = phase!=='setup' && phase!=='verdict'

  return (
    <div style={{width:'100%', maxWidth:920, display:'flex', gap:14, alignItems:'flex-start'}}>
      <section style={{flex:1, display:'flex', flexDirection:'column', gap:14, minWidth:0}}>
        <h2 style={{color:'#e8eaed', textAlign:'center', fontWeight:600}}>Interview — IELTS Practice</h2>
        <div className="presets">
          {IELTS_BANK.slice(0,4).map(q=> <button key={q} className={`preset ${currentQ===q?'active':''}`} onClick={()=> phase==='setup' && setCurrentQ(q)}>{q.slice(0,24)}</button>)}
        </div>
        {phase==='setup' && <textarea className="paragraph-input" rows={2} value={currentQ} onChange={e=> setCurrentQ(e.target.value)} placeholder="Starting question" />}

        <div style={{background:'#12141a', border:'1px solid #2b2f3a', borderRadius:12, padding:12, minHeight:300, maxHeight:420, overflowY:'auto', display:'flex', flexDirection:'column', gap:10}}>
          {msgs.length===0 && phase==='setup' && <p className="panel-note" style={{textAlign:'center'}}>Start the interview — Bhaskar will ask you IELTS-style questions. Answer by speaking, review, send. It keeps going until you stop and get scored.</p>}
          {msgs.map((m,i)=>
            <div key={i} style={{alignSelf: m.role==='you'?'flex-end':'flex-start', background: m.role==='you'?'#1a2a4a':'#1a1d24', border:'1px solid #2b2f3a', borderRadius:14, padding:'10px 14px', maxWidth:'78%', color:'#e8eaed', fontSize:'.92rem', lineHeight:1.5}}>
              <small style={{color:m.role==='you'?'#8ab4f8':'#9aa0a6', fontSize:11, textTransform:'uppercase'}}>{m.role==='you'?'You':'Bhaskar'}</small><br/>{m.text}
            </div>
          )}
          {(phase==='ai' || phase==='scoring') && <div style={{alignSelf:'flex-start', background:'#1a1d24', border:'1px solid #2b2f3a', borderRadius:14, padding:'10px 14px', color:'#9aa0a6', fontSize:'.9rem'}}>{phase==='ai' ? 'Bhaskar is thinking...' : 'Scoring your interview...'}</div>}
          <div ref={bottomRef} />
        </div>

        {(phase==='you') && (
          <div style={{background:'#1a1d24', border:'1px solid #2b2f3a', borderRadius:12, padding:12, minHeight:72}}>
            <small style={{color:'#9aa0a6', fontSize:11}}>Listening — speak your answer, conversion is live</small>
            <div style={{color:'#e8eaed', marginTop:6, minHeight:24}}><span className="final">{transcript}</span><span className="interim" style={{color:'#9aa0a6'}}> {interim}</span>{isListening && <span className="caret" />}</div>
            <div style={{marginTop:10, display:'flex', gap:8}}>
              <button className="clear" onClick={stopAndReview}>Stop</button>
              <span style={{color: listening?'#81c995':'#9aa0a6', fontSize:12, alignSelf:'center'}}>{listening?'recording':'paused'}</span>
            </div>
          </div>
        )}

        {(phase==='you_review') && (
          <div style={{background:'#1a1d24', border:'1px solid #3c414d', borderRadius:12, padding:12, display:'flex', flexDirection:'column', gap:8}}>
            <small style={{color:'#9aa0a6', fontSize:11}}>Review your answer — edit if needed before sending</small>
            <textarea className="paragraph-input" rows={3} value={draft} onChange={e=> setDraft(e.target.value)} placeholder="Your answer will appear here. Edit before sending." />
            <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
              <button className="clear" onClick={rerecord}>Rerecord</button>
              <button className="review" onClick={sendAnswer} disabled={!draft.trim()}>Send Answer</button>
            </div>
          </div>
        )}

        <div className="actions" style={{justifyContent:'center'}}>
          {phase==='setup' && <button className="review" onClick={startInterview} disabled={serverUp==='down'}>Start Interview</button>}
          {phase==='ai' && <span className="panel-note">Bhaskar asked next — your turn</span>}
        </div>

        {error && <p className="grammar-note error" style={{textAlign:'center'}}>{error}</p>}

        {phase==='verdict' && verdict && (
          <div style={{background:'#1a1d24', border:'1px solid #2b3a4a', borderRadius:12, padding:18, display:'flex', flexDirection:'column', gap:14}}>
            <div style={{display:'flex', gap:16, alignItems:'center', flexWrap:'wrap'}}>
              <div style={{width:110, height:110, borderRadius:'50%', border:'4px solid #2b2f3a', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center'}}>
                <span style={{fontSize:'1.1rem', fontWeight:700, color: verdict.totalScore>=70 ? '#81c995' : verdict.totalScore>=50 ? '#f0b232' : '#ea4335'}}>{verdict.band} band</span>
                <small style={{color:'#9aa0a6', fontSize:11}}>{verdict.totalScore}/100</small>
                <small style={{color:'#9aa0a6', fontSize:10}}>{gradeFor(verdict.totalScore)}</small>
              </div>
              <div style={{flex:1}}>
                <div style={{color:'#e8eaed', fontSize:14, fontWeight:600}}>{verdict.points} points</div>
                <div style={{color:'#9aa0a6', fontSize:12, marginTop:4}}>{verdict.flu.wordCount} words · {verdict.flu.wpm ?? '-'} wpm · {verdict.flu.fillerCount} fillers · {verdict.round+1} questions</div>
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
                <ul style={{listStyle:'none', display:'flex', flexDirection:'column', gap:6}}>{verdict.summary.strengths.map((s,i)=><li key={i} style={{color:'#cdd1d6', fontSize:'.92rem'}}>· {s}</li>)}</ul>
              </div>
            )}
            {verdict.summary?.improvements?.length>0 && (
              <div>
                <h4 style={{fontSize:11, color:'#f0b232', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6}}>To Improve</h4>
                <ul style={{listStyle:'none', display:'flex', flexDirection:'column', gap:6}}>{verdict.summary.improvements.map((imp,i)=><li key={i} style={{color:'#cdd1d6', fontSize:'.92rem'}}>{imp.area && <span style={{color:'#f0b232', fontWeight:600}}>{imp.area}: </span>}{imp.tip}</li>)}</ul>
              </div>
            )}
            {verdict.tips?.length>0 && (
              <div>
                <h4 style={{fontSize:11, color:'#8ab4f8', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6}}>Word Choice — {verdict.tips.length} issues</h4>
                <ul style={{listStyle:'none', display:'flex', flexDirection:'column', gap:8}}>{verdict.tips.map((t,i)=><li key={i} style={{color:'#cdd1d6', fontSize:'.92rem'}}><span style={{color:'#f0b232', fontWeight:600}}>{t.phrase}</span> → {t.alternatives.join(', ')}<span style={{color:'#9aa0a6'}}> — {t.reason}</span>{t.proverb && <><br/><span style={{color:'#8ab4f8', fontSize:'.85rem'}}>{t.proverb}</span></>}</li>)}</ul>
              </div>
            )}
            {verdict.grammarErrors?.length>0 && (
              <div>
                <h4 style={{fontSize:11, color:'#ea4335', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6}}>Grammar Errors — {verdict.grammarErrors.length}</h4>
                <ul style={{listStyle:'none', display:'flex', flexDirection:'column', gap:6}}>{verdict.grammarErrors.map((e,i)=><li key={i} style={{color:'#cdd1d6', fontSize:'.92rem'}}><span style={{color:'#ea4335'}}>{e.message}</span> {e.suggestions?.length ? <span style={{color:'#9aa0a6'}}> — try: {e.suggestions.join(', ')}</span> : null}</li>)}</ul>
              </div>
            )}
            {verdict.summary?.proverbs?.length>0 && (
              <div>
                <h4 style={{fontSize:11, color:'#8ab4f8', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:6}}>Proverbs and Idioms</h4>
                <ul style={{listStyle:'none', display:'flex', flexDirection:'column', gap:6}}>{verdict.summary.proverbs.map((p,i)=><li key={i} style={{color:'#cdd1d6', fontSize:'.92rem'}}><span style={{color:'#8ab4f8', fontWeight:600}}>{p.saying}</span> — {p.meaning}{p.example && <><br/><span style={{color:'#9aa0a6', fontSize:'.85rem'}}>e.g. {p.example}</span></>}</li>)}</ul>
              </div>
            )}
            <button className="review" onClick={()=>{setMsgs([]); setVerdict(null); setDraft(''); setPhase('setup')}}>Start New Interview</button>
          </div>
        )}

        <p className="panel-note" style={{textAlign:'center', fontSize:12}}>
          {phase==='you' && 'Speak, then press Stop to review'}
          {phase==='you_review' && 'Edit or rerecord, then send answer'}
          {phase==='ai' && 'Bhaskar asked next — answer again, it keeps going'}
        </p>
      </section>

      <div style={{width:160, position:'sticky', top:16, display: inInterview ? 'flex' : 'none', flexDirection:'column', gap:8}}>
        <div style={{background:'#1a1d24', border:'1px solid #2b2f3a', borderRadius:12, padding:12}}>
          <div style={{color:'#9aa0a6', fontSize:11, textTransform:'uppercase', letterSpacing:'.05em'}}>Interview</div>
          <div style={{color:'#e8eaed', fontSize:13, marginTop:4}}>Question {round+1}</div>
          <div style={{color:'#9aa0a6', fontSize:11, marginTop:2}}>{msgs.filter(m=>m.role==='you').length} answered</div>
          <div style={{marginTop:10, display:'flex', flexDirection:'column', gap:8}}>
            <button className="review" onClick={stopAndScore} disabled={phase==='scoring'} style={{background:'#ea4335', borderColor:'#ea4335', color:'#fff'}}>Stop interview and get score</button>
            <span style={{color:'#9aa0a6', fontSize:11, textAlign:'center'}}>Keeps going until you stop it</span>
          </div>
        </div>
        {verdict && <div style={{background:'#1a1d24', border:'1px solid #2b3a4a', borderRadius:12, padding:12, textAlign:'center'}}><div style={{color:'#9aa0a6', fontSize:11}}>Last band</div><div style={{color: verdict.totalScore>=70 ? '#81c995' : '#f0b232', fontSize:18, fontWeight:700}}>{verdict.band}</div><div style={{color:'#9aa0a6', fontSize:11}}>{verdict.totalScore}/100 · {verdict.points} pts</div></div>}
      </div>
    </div>
  )
}
