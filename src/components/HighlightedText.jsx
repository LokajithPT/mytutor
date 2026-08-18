export default function HighlightedText({ text, matches }) {
  if (!matches || matches.length === 0) return text

  const sorted = [...matches].sort((a, b) => a.offset - b.offset)
  const nodes = []
  let cursor = 0

  sorted.forEach((m, i) => {
    const start = m.offset
    const end = m.offset + m.length
    if (start < cursor) return // skip overlapping spans
    if (start > cursor) nodes.push(text.slice(cursor, start))

    const phrase = text.slice(start, end)
    const suggestion = m.suggestions?.length
      ? `\nSuggestion: ${m.suggestions.join(', ')}`
      : ''
    nodes.push(
      <mark key={i} className="grammar-error" title={m.message + suggestion}>
        {phrase}
      </mark>,
    )
    cursor = end
  })

  if (cursor < text.length) nodes.push(text.slice(cursor))
  return nodes
}
