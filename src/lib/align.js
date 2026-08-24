/**
 * Word alignment for the reading test.
 *
 * Spoken words (from speech recognition) are matched against the target
 * paragraph word-by-word, left to right:
 *   - exact match            -> 'correct'
 *   - matches next target    -> current word 'missed' (skipped), next correct
 *   - matches neither        -> current word 'incorrect'
 * Unreached words stay 'pending' unless `finalize` is set, which marks them
 * all 'missed' (used when the user stops reading).
 */

export function normalizeWord(word) {
  return String(word).toLowerCase().replace(/[^a-z0-9']+/g, '')
}

export function tokenize(text) {
  return String(text)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
}

export function alignSpoken(spokenWords, targetWords, { finalize = false } = {}) {
  const targetNorm = targetWords.map(normalizeWord)
  const status = targetNorm.map(() => 'pending')
  const extras = []
  let pointer = 0

  for (const raw of spokenWords) {
    const w = normalizeWord(raw)
    if (!w) continue
    if (pointer >= targetNorm.length) {
      extras.push(raw)
      continue
    }
    if (w === targetNorm[pointer]) {
      status[pointer] = 'correct'
      pointer++
    } else if (pointer + 1 < targetNorm.length && w === targetNorm[pointer + 1]) {
      status[pointer] = 'missed'
      status[pointer + 1] = 'correct'
      pointer += 2
    } else {
      status[pointer] = 'incorrect'
      pointer++
    }
  }

  if (finalize) {
    for (let i = 0; i < status.length; i++) {
      if (status[i] === 'pending') status[i] = 'missed'
    }
  }

  return { status, pointer: Math.min(pointer, targetNorm.length), extras }
}
