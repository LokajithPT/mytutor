// Shared PocketTTS wrapper — local-first, browser-only, streaming.
let tts = null, player = null, voices = {}
let ready = false, loading = null

export function isTTSReady(){ return ready }

export async function initTTS({ voiceName='alba', onProgress }={}) {
  if (ready) return tts
  if (loading) return loading
  loading = (async () => {
    const { PocketTTS, StreamingPlayer } = await import('pocket-tts-js')
    tts = new PocketTTS({ language:'english_2026-04', quantized:true, voiceCloning:false, maxThreads: 1 })
    try{ await tts.load((p)=> onProgress?.(p)) }catch(e){ console.error('PocketTTS load failed',e); throw e }
    player = new StreamingPlayer({ sampleRate: tts.sampleRate || 24000 })
    const v = await tts.loadVoice(voiceName)
    voices[voiceName]=v
    ready=true
    return tts
  })()
  return loading
}

export async function preloadVoice(name='alba'){
  if (!tts) await initTTS({voiceName:name})
  if (voices[name]) return voices[name]
  voices[name]= await tts.loadVoice(name)
  return voices[name]
}

function fallbackSpeak(text){
  if(!('speechSynthesis' in window)) throw new Error('No TTS available')
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.rate=1; u.pitch=1
  window.speechSynthesis.speak(u)
  return new Promise(res=> u.onend=res)
}
export async function speak(text, { voiceName='alba', onChunk, signal }={}) {
  try{
    if (!tts) await initTTS({voiceName})
    if (signal?.aborted) return
    let voice = voices[voiceName]
    if (!voice) {
      try{ voice = voices[voiceName] = await tts.loadVoice(voiceName) }catch{ voice = voices[voiceName]= await tts.loadVoice(tts.predefinedVoices?.[0] || 'alba') }
    }
    await player.resume()
    return await tts.generate(text, { voice, onChunk:(a,m)=>{ if(signal?.aborted) return; player.play(a,m); onChunk?.(a,m) } })
  }catch(e){
    console.warn('PocketTTS failed, falling back to Web Speech', e)
    return fallbackSpeak(text)
  }
}

export function stopTTS(){
  try{ player?.stop() }catch{}
  try{ tts?.stop?.() }catch{}
}

export function getSampleRate(){ return tts?.sampleRate || 24000 }
