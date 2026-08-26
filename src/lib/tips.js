/**
 * Word-choice coaching via the local STT server's /tips endpoint
 * (which proxies to llama.cpp / any OpenAI-compatible LLM).
 */
export async function fetchTips(text, { signal } = {}) {
  const trimmed = text.trim()
  if (!trimmed) return { tips: [], llmOk: true }

  const res = await fetch('/api/stt/tips', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: trimmed }),
    signal,
  })
  if (!res.ok) throw new Error(`tips request failed: ${res.status}`)
  const data = await res.json()
  return {
    tips: Array.isArray(data.tips) ? data.tips : [],
    llmOk: data.llm_ok !== false,
  }
}
