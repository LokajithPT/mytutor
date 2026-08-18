import { useVosk } from './hooks/useVosk'
import MicButton from './components/MicButton'

export default function App() {
  const {
    supported,
    loading,
    listening,
    transcript,
    interim,
    error,
    start,
    stop,
    reset,
  } = useVosk({ lang: 'en-US' })

  const toggle = () => (listening ? stop() : start())

  if (!supported) {
    return (
      <main className="app">
        <div className="card unsupported">
          <h1>Not supported</h1>
          <p>
            This browser doesn't support microphone capture. Please use a
            recent Chrome, Edge, or Firefox.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="app">
      <h1>Live Speech to Text</h1>

      <MicButton
        listening={listening}
        disabled={loading}
        onToggle={toggle}
      />

      <p className="status">
        {loading
          ? 'Loading offline model (first time only)…'
          : error
            ? `Error: ${error}`
            : listening
              ? 'Listening… click to stop'
              : 'Click the mic and start talking'}
      </p>

      <section className="transcript" aria-live="polite">
        <span className="final">{transcript}</span>
        <span className="interim">{interim}</span>
        {listening && <span className="caret" />}
      </section>

      <button className="clear" onClick={reset} disabled={listening}>
        Clear
      </button>
    </main>
  )
}
