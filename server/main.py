"""mytutor speech-to-text service.

Runs faster-whisper locally and serves word-level transcriptions for the
browser app. The model loads once at startup, then each request is a fast
CTranslate2 inference.

Model resolution: prefers the local folder server/models/faster-whisper-small
(download manually with curl; see repo README), falling back to the Hugging
Face hub copy of `small`.

Run:
    uv run main.py          (from this folder; creates .venv automatically)
  or classic:
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    python main.py

The browser reaches this through the Vite dev proxy at /api/stt/*.
"""

import json
import os
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import numpy as np
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

MODEL_SIZE = "small"
LOCAL_DIR = Path(__file__).resolve().parent / "models" / "faster-whisper-small"
MODEL_SOURCE = str(LOCAL_DIR) if (LOCAL_DIR / "model.bin").exists() else MODEL_SIZE

HOST = "127.0.0.1"
PORT = int(os.environ.get("STT_PORT", "8100"))
SAMPLE_RATE = 16000

# Word-choice tutor: any OpenAI-compatible chat endpoint works here
# (llama-server, Ollama's /v1, LM Studio, ...).
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://127.0.0.1:8080/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "local")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "no-key")

TIPS_SYSTEM_PROMPT = """You are a friendly spoken-English tutor. The user gives you a verbatim transcript of what they said out loud. Identify words or short phrases that are vague, weak, or imprecise, and suggest better alternatives.

Rules:
- Only word-choice coaching; do NOT fix grammar or punctuation.
- "phrase" MUST be copied exactly from the transcript (a verbatim substring).
- Give 2-4 natural alternatives per item.
- "reason" is at most 12 words.
- Maximum 8 items. If nothing needs improving, return [].

Respond ONLY with a JSON array, e.g.
[{"phrase":"nice","alternatives":["kind","welcoming"],"reason":"'nice' is vague"}]"""

TIPS_SUMMARY_PROMPT = """You are a friendly spoken-English coach. The user gave you a verbatim transcript of them speaking freely (answering a prompt out loud). Give encouraging, specific feedback on their *fluency and structure* — not grammar, not word choice (another pass handles that).

Cover, briefly:
- "headline": one upbeat sentence about how they did.
- "strengths": 2-3 short bullet strings of what went well.
- "improvements": 2-4 objects, each {"area": short label, "tip": one concrete sentence}. Areas may include pace, fillers, organization, elaboration.

Respond ONLY with a JSON object, e.g.
{"headline":"Confident delivery with clear points.","strengths":["Good pace","Stayed on topic"],"improvements":[{"area":"Fillers","tip":"Try pausing instead of saying 'like' between thoughts."}]}"""

model: WhisperModel | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global model
    started = time.time()
    print(f"Loading model from: {MODEL_SOURCE} ...", flush=True)
    model = WhisperModel(MODEL_SOURCE, device="auto", compute_type="int8")
    # Warmup so the first real request isn't cold.
    silence = np.zeros(SAMPLE_RATE // 2, dtype=np.float32)
    list(model.transcribe(silence, language="en")[0])
    print(f"Model ready in {time.time() - started:.1f}s.", flush=True)
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _llm_headers() -> dict:
    return {"Authorization": f"Bearer {LLM_API_KEY}"}


@app.get("/health")
async def health() -> dict:
    llm_ok = False
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            r = await client.get(f"{LLM_BASE_URL}/models", headers=_llm_headers())
            llm_ok = r.status_code == 200
    except Exception:
        pass
    return {
        "ready": model is not None,
        "model": MODEL_SIZE,
        "source": "local folder" if MODEL_SOURCE == str(LOCAL_DIR) else f"hub:{MODEL_SIZE}",
        "llm": {"ok": llm_ok, "base_url": LLM_BASE_URL},
    }


@app.post("/transcribe")
async def transcribe(request: Request, offset: float = 0.0) -> dict:
    """Accepts raw 16-bit little-endian mono PCM at 16kHz.

    `offset` is the chunk's start time on the client's audio timeline;
    returned word timestamps are already shifted into that timeline.
    """
    if model is None:
        return {"words": [], "error": "model not loaded"}

    pcm = await request.body()
    if len(pcm) < SAMPLE_RATE // 10:  # <100ms of audio: nothing to do
        return {"words": []}

    audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    segments, _ = model.transcribe(
        audio,
        language="en",
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 300},
        # Anti-hallucination: silence/noise makes Whisper invent stock
        # phrases ("I don't know", names...). Don't condition across
        # segments, and refuse low-confidence or loopy output outright.
        condition_on_previous_text=False,
        no_speech_threshold=0.75,
        log_prob_threshold=-0.85,
        compression_ratio_threshold=2.2,
    )

    words = []
    for segment in segments:
        for w in segment.words or []:
            text = w.word.strip()
            if text:
                words.append(
                    {
                        "text": text,
                        "start": round(w.start + offset, 3),
                        "end": round(w.end + offset, 3),
                    }
                )
    return {"words": words}


def parse_tips(content: str) -> list:
    """Best-effort extraction of a JSON array of tips from LLM output."""
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.S)
    start, end = s.find("["), s.rfind("]")
    if start == -1 or end <= start:
        return []
    try:
        data = json.loads(s[start : end + 1])
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    tips = []
    for item in data[:10]:
        if not isinstance(item, dict):
            continue
        phrase = str(item.get("phrase") or "").strip()
        alts = [str(a).strip() for a in (item.get("alternatives") or []) if str(a).strip()]
        reason = str(item.get("reason") or "").strip()
        if phrase and alts:
            tips.append({"phrase": phrase, "alternatives": alts[:4], "reason": reason})
    return tips


def parse_summary(content: str) -> dict | None:
    """Best-effort extraction of a JSON object summary from LLM output."""
    s = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.S)
    start, end = s.find("{"), s.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        data = json.loads(s[start : end + 1])
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    headline = str(data.get("headline") or "").strip()
    strengths = [str(x).strip() for x in (data.get("strengths") or []) if str(x).strip()]
    improvements = []
    for item in data.get("improvements") or []:
        if not isinstance(item, dict):
            continue
        area = str(item.get("area") or "").strip()
        tip = str(item.get("tip") or "").strip()
        if tip:
            improvements.append({"area": area, "tip": tip})
    if not headline and not strengths and not improvements:
        return None
    return {"headline": headline, "strengths": strengths, "improvements": improvements}


@app.post("/tips")
async def tips(request: Request) -> dict:
    """Coaching for a transcript via the local LLM.

    mode="word_choice" (default): vague-word alternatives.
    mode="conversation_summary": structured fluency/structure feedback.
    """
    try:
        body = await request.json()
    except Exception:
        return {"tips": [], "summary": None, "llm_ok": True}
    text = (body.get("text") or "").strip()[:4000]
    mode = (body.get("mode") or "word_choice").lower()
    if not text:
        return {"tips": [], "summary": None, "llm_ok": True}

    system = TIPS_SUMMARY_PROMPT if mode == "conversation_summary" else TIPS_SYSTEM_PROMPT
    max_tokens = 800 if mode == "conversation_summary" else 800
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(
                f"{LLM_BASE_URL}/chat/completions",
                json={
                    "model": LLM_MODEL,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": text},
                    ],
                    "temperature": 0.3,
                    "max_tokens": max_tokens,
                    "stream": False,
                },
                headers=_llm_headers(),
            )
            r.raise_for_status()
            content = r.json()["choices"][0]["message"]["content"]
    except Exception as e:
        return {
            "tips": [],
            "summary": None,
            "llm_ok": False,
            "error": f"LLM unreachable ({e.__class__.__name__})",
        }

    if mode == "conversation_summary":
        return {"tips": [], "summary": parse_summary(content), "llm_ok": True}

    # Integrity: only keep tips whose phrase truly appears in what was said
    # (case-insensitive), so the UI never claims "you said X" falsely.
    lower = text.lower()
    valid = [t for t in parse_tips(content) if t["phrase"].lower() in lower]
    return {"tips": valid, "summary": None, "llm_ok": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT)
