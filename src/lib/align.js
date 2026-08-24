/**
 * Word alignment for the reading test.
 *
 * Spoken words (from speech recognition) are matched against the target
 * paragraph left to right. Speech recognition is messy, so besides exact
 * matches we tolerate its common quirks:
 *   - compound splits : "hard working"  <-> target "hardworking"
 *   - merged words    : one token covering several target words
 *   - dropped words   : a small lookahead resyncs and marks the gap 'missed'
 *
 * Unreached words stay 'pending' unless `finalize` is set, which marks them
 * all 'missed' (used when the user stops reading).
 */

// How many target words ahead we search for a resync point.
const MAX_LOOKAHEAD = 3
// How many consecutive spoken words may be joined to form one target word
// (and vice versa).
const MAX_GROUP = 3

export function normalizeWord(word) {
  return String(word)
    .toLowerCase()
    .replace(/[\u2018\u2019\u02BC]/g, "'") // curly apostrophes -> straight
    .replace(/[^a-z0-9']+/g, '')
}

export function tokenize(text) {
  return String(text)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

export function alignSpoken(spokenWords, targetWords, { finalize = false } = {}) {
  const targetNorm = targetWords.map(normalizeWord)
  const spokenNorm = spokenWords.map(normalizeWord)
  const status = targetNorm.map(() => 'pending')
  const extras = []

  const markMissed = (from, to) => {
    for (let i = from; i < to; i++) status[i] = 'missed'
  }

  let ti = 0 // target index
  let si = 0 // spoken index

  while (si < spokenNorm.length && ti < targetNorm.length) {
    const s = spokenNorm[si]
    if (!s) {
      si++
      continue
    }

    let matched = false

    // A) Join 1..MAX_GROUP spoken words; do they form a nearby target word?
    for (let m = 1; m <= MAX_GROUP && si + m <= spokenNorm.length && !matched; m++) {
      const joined = spokenNorm.slice(si, si + m).join('')
      if (!joined) break
      for (let k = 0; k <= MAX_LOOKAHEAD && ti + k < targetNorm.length; k++) {
        if (joined === targetNorm[ti + k]) {
          markMissed(ti, ti + k)
          status[ti + k] = 'correct'
          ti += k + 1
          si += m
          matched = true
          break
        }
      }
    }
    if (matched) continue

    // B) One spoken word covering several consecutive target words.
    for (let t = 2; t <= MAX_GROUP && ti + t <= targetNorm.length; t++) {
      if (s === targetNorm.slice(ti, ti + t).join('')) {
        for (let i = ti; i < ti + t; i++) status[i] = 'correct'
        ti += t
        si += 1
        matched = true
        break
      }
    }
    if (matched) continue

    // C) No match: current target word is wrong, move both pointers on.
    status[ti] = 'incorrect'
    ti += 1
    si += 1
  }

  while (si < spokenNorm.length) {
    if (spokenNorm[si]) extras.push(spokenWords[si])
    si++
  }

  if (finalize) {
    for (let i = 0; i < status.length; i++) {
      if (status[i] === 'pending') status[i] = 'missed'
    }
  }

  return { status, pointer: Math.min(ti, targetNorm.length), extras }
}
