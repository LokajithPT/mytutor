const ONLINE_ENDPOINT = 'https://api.languagetool.org/v2/check'

// Common confusions a tiny local checker can catch without any network.
// Each rule: a regex (on lowercased text) and the message + suggestion.
const LOCAL_RULES = [
  {
    re: /\byour\s+([a-z]+ing|book|car|name|friend|house|dog|cat|idea)\b/i,
    message: '"your" is possessive; use "you\'re" before a verb/feature.',
    suggestions: ['you\'re'],
  },
  {
    re: /\byoure\b/i,
    message: 'Did you mean the possessive "your"?',
    suggestions: ['your'],
  },
  {
    re: /\bits\s+([a-z]+ing|nice|good|fun|easy|late|cold)\b/i,
    message: '"its" is possessive; use "it\'s" before a verb/feature.',
    suggestions: ['it\'s'],
  },
  {
    re: /\bit\'s\s+(book|car|name|friend|house|dog|cat|idea|tail|color)\b/i,
    message: 'Did you mean the possessive "its"?',
    suggestions: ['its'],
  },
  {
    re: /\bthen\b(?:\s+\w+){0,3}?\s+\bthan\b/i,
    message: '"then" (time) vs "than" (comparison) — check which you meant.',
    suggestions: ['than'],
  },
  {
    re: /\bcould\s+of\b|\bwould\s+of\b|\bshould\s+of\b/i,
    message: 'Use "have" after could/would/should, not "of".',
    suggestions: ['could have', 'would have', 'should have'],
  },
  {
    re: /\b(definitely|really|very|so)\s+\1\b/i,
    message: 'Repeated word — remove the duplicate.',
    suggestions: [],
  },
  {
    re: /\b(alot|alot of)\b/i,
    message: '"a lot" is two words.',
    suggestions: ['a lot'],
  },
  {
    re: /\bloose\b\s+(weight|time|money|change|screw)\b/i,
    message: 'Use "lose" (verb) not "loose" (adjective) here.',
    suggestions: ['lose'],
  },
]

/**
 * Offline, rule-based grammar scan. Returns the same span shape as the
 * online checker: { offset, length, message, short, suggestions[] }.
 * This is intentionally small — it covers the highest-frequency mistakes
 * so the app can stay fully local by default.
 */
export function checkGrammarLocal(text) {
  const trimmed = String(text).trim()
  if (!trimmed) return []
  const matches = []
  for (const rule of LOCAL_RULES) {
    rule.re.lastIndex = 0
    const m = rule.re.exec(trimmed)
    if (m) {
      matches.push({
        offset: m.index,
        length: m[0].length,
        message: rule.message,
        short: rule.message,
        suggestions: rule.suggestions,
      })
    }
  }
  // Drop overlaps, keeping the earliest.
  matches.sort((a, b) => a.offset - b.offset)
  const out = []
  let cursor = -1
  for (const m of matches) {
    if (m.offset >= cursor) {
      out.push(m)
      cursor = m.offset + m.length
    }
  }
  return out
}

/**
 * Grammar check. Online (LanguageTool) is opt-in; by default we run the
 * local checker so the app needs no network.
 *
 * @param {string} text
 * @param {object} opts
 * @param {boolean} [opts.online]  use LanguageTool's hosted API
 * @param {string}  [opts.lang]
 * @param {AbortSignal} [opts.signal]
 */
export async function checkGrammar(text, { online = false, lang = 'en-US', signal } = {}) {
  const trimmed = String(text).trim()
  if (!trimmed) return []

  if (!online) return checkGrammarLocal(trimmed)

  const body = new URLSearchParams({ text: trimmed, language: lang })
  const res = await fetch(ONLINE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal,
  })
  if (!res.ok) throw new Error(`grammar check failed: ${res.status}`)

  const data = await res.json()
  return (data.matches || []).map((m) => ({
    offset: m.offset,
    length: m.length,
    message: m.message,
    short: m.shortMessage || m.message,
    suggestions: (m.replacements || []).map((r) => r.value),
  }))
}
