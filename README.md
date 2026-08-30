# mytutor

Speak. See your words instantly. Get coached.

A local-first speech tutor: read passages aloud and watch a Monkeytype-style
word tracker score you live, free-talk and get a fluency score + AI coaching,
and track your progress over time — **everything runs on your own machine**.
The only optional outbound call is the word-choice/coaching LLM, and an
online grammar check that is *off by default*.

## Features

- **Live speech-to-text** — faster-whisper (`small`, int8) served locally;
  words land in well under a second
- **Dictate mode** — verbatim transcript with offline grammar flags (a small
  built-in checker) and on-demand **better-word tips** from a local LLM
- **Reading Test** — paste or pick a paragraph, read aloud: correct words
  light up, wrong/skipped words go red, caret follows your voice, timer + WPM
- **Conversation Coach** (new) — pick a prompt, speak for a minute or two,
  get a **fluency score**, filler-word check, vocabulary richness, and an AI
  coaching summary. Fully local analytics; AI summary optional
- **Progress** (new) — past sessions, score trend charts, and a weak-word
  bank — all in `localStorage`, no account needed
- **Mic settings** — device picker with a live level meter; selection persists
- **Private & offline-first** — audio never leaves your machine; grammar is
  local by default

## Quick start (one command)

```bash
./start.sh
```

This installs frontend deps if needed and launches both the Vite dev server
(frontend) and the local STT server. Open **http://localhost:5173**.

Or run them yourself:

```bash
npm install
npm run dev          # frontend only  → http://localhost:5173

# in a second terminal:
cd server && uv run main.py      # local STT server :8100
```

The Whisper model auto-resolves: it prefers `server/models/faster-whisper-small/`
(manual download, see below), else fetches `small` from Hugging Face.

<details>
<summary>Manual Whisper model download (resumable, no hub client)</summary>

```bash
cd server && mkdir -p models/faster-whisper-small && cd models/faster-whisper-small
for f in config.json model.bin tokenizer.json vocabulary.txt; do
  curl -L -C - --retry 20 --retry-all-errors \
    -o "$f" "https://huggingface.co/Systran/faster-whisper-small/resolve/main/$f"
done
```
</details>

## Optional: AI coaching tips (local LLM)

Word-choice tips and the Conversation Coach summary use a local OpenAI-
compatible LLM (e.g. `llama-server`). Nothing is sent to the cloud.

```bash
# any GGUF, e.g. Qwen3-4B
llama-server -m path/to/model.Q4_K_M.gguf --port 8080 --ctx-size 4096
```

Point `LLM_BASE_URL` at a different endpoint if you use Ollama/LM Studio.
Without it, the app still works — it just shows "Local LLM not reachable"
where AI feedback would appear, and the local fluency score still runs.

## Usage

1. Run `./start.sh` (or start frontend + STT server separately).
2. Open the app → choose a mode from the top nav:
   - **Dictate** — mic → talk → *Review my speech* for better words.
   - **Reading** — pick/paste a paragraph → mic → read aloud.
   - **Coach** — pick a prompt → mic → talk → get scored + coached.
   - **Progress** — review sessions, trends, weak words.
3. Click the mic icon (top-right) for mic device + grammar settings.

## Architecture

```
Browser (React/Vite)
  │ mic ── PCM chunks every ~0.9s
  ▼
FastAPI :8100  (/api/stt via Vite proxy)
  ├─ /transcribe ─▶ faster-whisper small (word timestamps, VAD)
  └─ /tips ───────▶ llama-server :8080 (optional; Qwen3-4B GGUF)
```

Local analytics (fluency score, filler words, WPM, vocabulary, speaking
time) are computed in the browser from the transcript and capture timing —
no model, no network.

## Environment variables (speech server)

| Var | Default | Purpose |
|---|---|---|
| `STT_PORT` | `8100` | Server port |
| `LLM_BASE_URL` | `http://127.0.0.1:8080/v1` | Tips backend |
| `LLM_MODEL` | `local` | Model name sent to the backend |
| `LLM_API_KEY` | `no-key` | Only if your endpoint needs one |

## Troubleshooting

- **Red banner "Speech server is not running"** — start `server/main.py`; the
  app re-checks every 10s automatically
- **"Local LLM not reachable"** after reviewing — start `llama-server`
- **Words feel laggy** — check that nothing else is hammering the CPU
- **Grammar not checking** — online grammar is off by default (local-first);
  enable *Online grammar (LanguageTool)* in mic settings if you want it
- **Mic meter barely moves** — raise OS input gain or pick another device
