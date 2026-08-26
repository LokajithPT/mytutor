# mytutor

Speak. See your words instantly. Get coached.

A local-first speech tutor: read passages aloud and watch a Monkeytype-style
word tracker score you live, or free-talk and get grammar flags plus
word-choice coaching — **everything runs on your own machine**.

## Features

- **Live speech-to-text** — faster-whisper (`small`, int8) served locally;
  words land in well under a second
- **Reading Test** — paste or pick a paragraph, read aloud: correct words
  light up, wrong/skipped words go red, caret follows your voice, timer + WPM
- **Dictate mode** — verbatim transcript with grammar/punctuation flags
  (LanguageTool) and on-demand **word-choice tips** from a local LLM
  (*"you said 'nice' → try 'kind', 'welcoming'"*)
- **Mic settings** — device picker with a live level meter; selection persists
- **Private & offline** — audio never leaves your machine; the only outbound
  call is LanguageTool for grammar (optional)

## Architecture

```
Browser (React/Vite)
  │ mic ── PCM chunks every ~0.9s
  ▼
FastAPI :8100  (/api/stt via Vite proxy)
  ├─ /transcribe ─▶ faster-whisper small (word timestamps, VAD)
  └─ /tips ───────▶ llama-server :8080 (Qwen3-4B GGUF, OpenAI-compatible)
```

## Setup

### Frontend

```bash
npm install
npm run dev          # http://localhost:5173
```

### Speech server

```bash
cd server
uv run main.py       # creates .venv, installs deps, loads model
# classic alternative:
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt && python main.py
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

### Local LLM (word-choice tips)

```bash
sudo pacman -S llama.cpp        # Arch; adapt for your distro
llama-server \
  -m ~/.cache/huggingface/hub/models--mmnga--Qwen3-4B-Instruct-2507-gguf/snapshots/c1405acde3ff15e3c6df0a77f1bf2529e2c98c3e/Qwen3-4B-Instruct-2507-Q4_K_M.gguf \
  --port 8080 --ctx-size 4096
```

Any OpenAI-compatible endpoint works (Ollama's `/v1`, LM Studio, ...) — just
point `LLM_BASE_URL` at it.

### Environment variables (speech server)

| Var | Default | Purpose |
|---|---|---|
| `STT_PORT` | `8100` | Server port |
| `LLM_BASE_URL` | `http://127.0.0.1:8080/v1` | Tips backend |
| `LLM_MODEL` | `local` | Model name sent to the backend |
| `LLM_API_KEY` | `no-key` | Only if your endpoint needs one |

## Usage

1. Start the speech server (and `llama-server` if you want tips)
2. `npm run dev` → open the app
3. **Reading Test**: pick/paste a paragraph → click the mic → read aloud
4. **Dictate**: click the mic → talk → hit **Review my speech** for coaching

## Troubleshooting

- **Red banner "Speech server is not running"** — start `server/main.py`; the
  app re-checks every 10s automatically
- **"Local LLM not reachable"** after reviewing — start `llama-server`
- **Words feel laggy** — check that nothing else is hammering the CPU; the
  default cadence targets <1s trailing delay
- **Mic meter barely moves** — raise OS input gain or pick another device in
  mic settings
