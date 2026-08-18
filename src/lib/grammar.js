const ENDPOINT = 'https://api.languagetool.org/v2/check'

/**
 * Returns grammar issues for `text` as a list of spans:
 *   { offset, length, message, short, suggestions[] }
 * The original `text` is never modified — callers highlight the spans only.
 */
export async function checkGrammar(text, { lang = 'en-US', signal } = {}) {
  const trimmed = text.trim()
  if (!trimmed) return []

  const body = new URLSearchParams({ text: trimmed, language: lang })
  const res = await fetch(ENDPOINT, {
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
