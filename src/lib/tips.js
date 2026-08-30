/**
 * Word-choice / conversation coaching via the local STT server's /tips
 * endpoint (which proxies to llama.cpp / any OpenAI-compatible LLM).
 *
 * `mode` selects the prompt:
 *   - "word_choice"       : vague-word alternatives (default)
 *   - "conversation_summary" : structured fluency/structure feedback
 */
export async function fetchTips(text, { signal, mode = 'word_choice' } = {}) {
  const trimmed = text.trim()
  if (!trimmed) return { tips: [], llmOk: true, summary: null }

  const res = await fetch('/api/stt/tips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: trimmed, mode }),
    signal,
  })
  if (!res.ok) throw new Error(`tips request failed: ${res.status}`)
  const data = await res.json()
  return {
    tips: Array.isArray(data.tips) ? data.tips : [],
    llmOk: data.llm_ok !== false,
    summary: data.summary ?? null,
  }
}
