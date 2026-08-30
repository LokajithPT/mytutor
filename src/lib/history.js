/**
 * Session history + weak-word bank, persisted in localStorage.
 *
 * No backend needed — the POC stays local. We cap stored sessions so the
 * browser doesn't grow without bound.
 */

const SESSIONS_KEY = 'mytutor.sessions'
const WEAK_KEY = 'mytutor.weakWords'
const MAX_SESSIONS = 50

export function loadSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    const val = raw ? JSON.parse(raw) : []
    return Array.isArray(val) ? val : []
  } catch {
    return []
  }
}

export function saveSession(record) {
  const all = loadSessions()
  all.push({ id: Date.now(), ...record })
  const trimmed = all.slice(-MAX_SESSIONS)
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(trimmed))
  } catch {
    /* quota — ignore for a POC */
  }
  return trimmed
}

export function clearSessions() {
  try {
    localStorage.removeItem(SESSIONS_KEY)
  } catch {
    /* ignore */
  }
}

export function loadWeakWords() {
  try {
    const raw = localStorage.getItem(WEAK_KEY)
    const val = raw ? JSON.parse(raw) : {}
    return val && typeof val === 'object' ? val : {}
  } catch {
    return {}
  }
}

/**
 * Merge new weak words into the bank with occurrence counts. `words` may be
 * an array of strings (e.g. misread reading-test words, or tip phrases).
 */
export function addWeakWords(words) {
  const bank = loadWeakWords()
  for (const w of words) {
    const key = String(w).toLowerCase().trim()
    if (!key) continue
    bank[key] = (bank[key] || 0) + 1
  }
  try {
    localStorage.setItem(WEAK_KEY, JSON.stringify(bank))
  } catch {
    /* ignore */
  }
  return bank
}

export function clearWeakWords() {
  try {
    localStorage.removeItem(WEAK_KEY)
  } catch {
    /* ignore */
  }
}

// Aggregate a score for a session that the History view can trend over time.
export function sessionScore(record) {
  if (record.mode === 'coach') return record.fluencyScore ?? null
  if (record.mode === 'read') return record.accuracy ?? null
  return null
}
