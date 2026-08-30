/**
 * Local fluency analytics for the Conversation Coach.
 *
 * Everything here runs in the browser with no model and no network — it
 * derives speech-quality signals from the transcript text plus the timing
 * numbers the capture hook already tracks (words, elapsed time, speaking
 * airtime). This is what makes the coach demo-able fully offline.
 */

// Words that signal hesitation / filler speech when they punctuate an
// utterance. Whisper keeps most of these verbatim, so we can count them.
export const FILLER_WORDS = new Set([
  'um',
  'uh',
  'er',
  'ah',
  'like',
  'youknow',
  'you-know',
  'basically',
  'actually',
  'literally',
  'honestly',
  'really',
  'very',
  'just',
  'so',
  'right',
  'okay',
  'ok',
  'well',
  'i mean',
  'kind of',
  'sort of',
  'stuff',
  'things',
  'whatever',
])

function tokenizeRaw(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

function clean(word) {
  return word.replace(/[^a-z0-9']/g, '')
}

/**
 * @param {string} transcript  finalized transcript
 * @param {object} opts
 * @param {number} [opts.elapsedSeconds]  wall time of the session
 * @param {number} [opts.speakingSeconds] time actually spent speaking
 * @returns aggregated fluency metrics
 */
export function analyzeFluency(transcript, { elapsedSeconds = 0, speakingSeconds = 0 } = {}) {
  const raw = tokenizeRaw(transcript)
  const words = raw.map(clean).filter(Boolean)
  const count = words.length

  const fillerHits = {}
  let fillerCount = 0
  for (const w of raw) {
    if (FILLER_WORDS.has(w)) {
      fillerCount++
      fillerHits[w] = (fillerHits[w] || 0) + 1
    }
  }

  const unique = new Set(words).size
  const wpm = elapsedSeconds > 0 ? Math.round((count / elapsedSeconds) * 60) : null
  const fillerRatio = count > 0 ? fillerCount / count : 0
  const uniqueRatio = count > 0 ? unique / count : 0
  const speakingRatio =
    elapsedSeconds > 0 && speakingSeconds > 0
      ? Math.min(1, speakingSeconds / elapsedSeconds)
      : null

  // Composite "fluency score" 0-100: reward pace + vocabulary variety,
  // penalize filler density and dead air. Tuned for a forgiving demo feel.
  let score = 100
  score -= Math.round(fillerRatio * 140) // ~71% filler would zero it out
  if (speakingRatio != null) score -= Math.round((1 - speakingRatio) * 25)
  if (uniqueRatio > 0) score += Math.round((uniqueRatio - 0.45) * 18)
  if (wpm != null) {
    if (wpm < 80) score -= Math.round((80 - wpm) * 0.25)
    else if (wpm > 180) score -= Math.round((wpm - 180) * 0.15)
  }
  score = Math.max(0, Math.min(100, score))

  return {
    wordCount: count,
    uniqueCount: unique,
    fillerCount,
    fillerRatio,
    fillerHits,
    uniqueRatio,
    wpm,
    speakingRatio,
    speakingSeconds,
    elapsedSeconds,
    score,
  }
}

// A short grade label for the score, used in the summary ring.
export function gradeFor(score) {
  if (score >= 85) return 'Fluent'
  if (score >= 70) return 'Solid'
  if (score >= 50) return 'Getting there'
  return 'Practice more'
}
