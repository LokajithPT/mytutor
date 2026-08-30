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

# load server/.env if present (for NVIDIA NIM keys — not committed)
try:
    from pathlib import Path as _P
    _env = _P(__file__).resolve().parent / ".env"
    if _env.exists():
        for line in _env.read_text().splitlines():
            line=line.strip()
            if not line or line.startswith("#") or "=" not in line: continue
            k,v=line.split("=",1)
            os.environ.setdefault(k.strip(), v.strip())
except Exception:
    pass

MODEL_SIZE = "small"
LOCAL_DIR = Path(__file__).resolve().parent / "models" / "faster-whisper-small"
MODEL_SOURCE = str(LOCAL_DIR) if (LOCAL_DIR / "model.bin").exists() else MODEL_SIZE

HOST = "127.0.0.1"
PORT = int(os.environ.get("STT_PORT", "8100"))
SAMPLE_RATE = 16000

# Word-choice tutor: any OpenAI-compatible chat endpoint works here
# (llama-server, Ollama's /v1, LM Studio, ...).
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://127.0.0.1:8080/v1")
LLM_MODEL = os.environ.get("LLM_MODEL", "Qwen/Qwen2.5-1.5B-Instruct-GGUF:Q4_K_M")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "no-key")

TIPS_SYSTEM_PROMPT = """You are a friendly spoken-English tutor with a love for proverbs, idioms and phrasal verbs. The user gives you a verbatim transcript of what they said out loud. Identify words or short phrases that are vague, weak, or imprecise, and suggest better alternatives. Where natural, also give a relevant proverb/idiom/phrasal verb they could use instead — this is optional but delightful when it fits.

Rules:
- Only word-choice + idiom coaching; do NOT fix grammar or punctuation.
- "phrase" MUST be copied exactly from the transcript (a verbatim substring).
- Give 2-4 natural alternatives per item.
- "reason" is at most 12 words.
- "proverb" is optional: a short idiom/proverb/phrasal verb + its meaning in parentheses, e.g. "break the ice (to ease tension)". Omit or leave empty if none fits naturally.
- Maximum 8 items. If nothing needs improving, return [].

Respond ONLY with a JSON array, e.g.
[{"phrase":"nice","alternatives":["kind","welcoming"],"reason":"'nice' is vague","proverb":"a breath of fresh air (something pleasant)"}]"""

TIPS_SUMMARY_PROMPT = """You are a friendly spoken-English coach who loves proverbs, idioms and storytelling. The user gave you a verbatim transcript of them speaking freely (answering a prompt out loud). Give encouraging, specific feedback on their *fluency and structure* — not grammar, not word choice (another pass handles that).
You have ONLY the transcript text and derived metrics (word count, filler count). You have NO audio, NO video, NO eye contact, NO body language, NO posture, NO gestures, NO facial expression. NEVER invent or mention eye contact, gaze, posture, gestures, appearance, smile, eye, face, body, stage presence.

Cover, briefly:
- "headline": one upbeat sentence about how they did.
- "strengths": 2-3 short bullet strings of what went well — grounded ONLY in transcript evidence (e.g. clear structure, stayed on topic, good vocabulary variety, steady pace inferred from filler/word count). NEVER claim visual traits.
- "improvements": 2-4 objects, each {"area": short label, "tip": one concrete sentence}. Areas may include pace, fillers, organization, elaboration, vocabulary variety — all inferred from text only.
- "proverbs": 1-3 proverbs/idioms/phrasal verbs relevant to what they said, each {"saying": the idiom, "meaning": short gloss, "example": how to use it in a sentence}. Pick ones they could have used.

Respond ONLY with a JSON object, e.g.
{"headline":"Confident delivery with clear points.","strengths":["Good pace inferred from low filler rate","Stayed on topic and organized ideas"],"improvements":[{"area":"Fillers","tip":"Try pausing instead of saying 'like' between thoughts."}],"proverbs":[{"saying":"practice makes perfect","meaning":"improvement comes with repetition","example":"You said 'try again and again' — you could say 'practice makes perfect'."}]}"""



DEBATE_PROMPT = """You are Bhaskar — a 28-year-old, sharp, warm, witty guy from India who loves a good debate. You talk like a real human, not a coach or bot. Contractions, short sentences, a little humor, direct but respectful. You never say you are an AI. You never give coaching feedback or bullet points. You are the opponent.

Task: Read the motion and what the user just said. Give a direct counter-argument in 70-90 words, opposite stance, like you are replying in a chat. Be conversational, add one specific concrete example (real life, work, college) and maybe one rhetorical question. No headings, no bullet points, no "as an AI", no emoji.

Respond ONLY with the reply text — no JSON, no quotes wrapper."""

COACH_CHAT_PROMPT = """You are Bhaskar — a warm, encouraging conversational partner from India, 28. You chat like a real human friend, not a bot. Keep it natural (40-70 words), curious, supportive, contractions, short sentences.

Rules:
- Always reference one specific detail the user just said. If they said almost nothing (e.g. "let me tell you a story" / "hi" / <10 words without substance), warmly invite them to start: "Go ahead, I'm listening — what happened?" and tie it to the original prompt.
- Don't repeat the generic "Nice — tell me a bit more. What happened next?" — make it specific to what they said.
- Ask exactly one open follow-up question that keeps them talking about the prompt topic.
- Never coach, never score, no bullet points, no emoji, never say you are AI.

Respond ONLY with your chat reply — one paragraph."""

def reading_prompt_for_level(level: int, words: int | None = None) -> str:
    lvl = max(1, min(10, int(level)))
    descriptions = {
        1: "Level 1 — very easy (A1). Simple present, most common 500 words, no complex clauses.",
        2: "Level 2 — easy (A1+). Simple sentences, basic connectors (and, but, because).",
        3: "Level 3 — easy+ (A2). A bit more detail, past tense allowed, everyday topics.",
        4: "Level 4 — lower intermediate (A2+). Mix of present/past, some adjectives/adverbs.",
        5: "Level 5 — intermediate (B1). Varied sentences, some B1 vocabulary, one or two complex sentences.",
        6: "Level 6 — intermediate+ (B1+). Richer vocabulary, opinions and reasons.",
        7: "Level 7 — upper intermediate (B2). Complex sentences, connectors (however, although), abstract ideas.",
        8: "Level 8 — advanced (B2+). Nuanced vocabulary, idiomatic hints, longer sentences.",
        9: "Level 9 — very advanced (C1). Sophisticated vocabulary, academic tone, subtle idioms.",
        10: "Level 10 — expert (C1/C2). Dense academic/abstract, rich idioms and complex structures, challenging even for natives.",
    }
    desc = descriptions[lvl]
    wc = f" Exactly {words} words (within 2 words)." if words else " Keep it within the word count for the level."
    return f"""You are a reading passage generator for English learners. Generate a single paragraph for a read-aloud test at {desc}

Rules:
- Exactly one paragraph, no title, no bullet points, no extra explanation.
- Interesting, natural topic (culture, science, travel, life) — keep it engaging.
- Use clear punctuation so it can be read aloud.{wc}
- Respond ONLY with the paragraph text."""

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
        proverb = str(item.get("proverb") or "").strip()
        if phrase and alts:
            tips.append({"phrase": phrase, "alternatives": alts[:4], "reason": reason, "proverb": proverb})
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
    proverbs = []
    for item in data.get("proverbs") or []:
        if not isinstance(item, dict): continue
        saying = str(item.get("saying") or "").strip()
        meaning = str(item.get("meaning") or "").strip()
        example = str(item.get("example") or "").strip()
        if saying:
            proverbs.append({"saying": saying, "meaning": meaning, "example": example})
    if not headline and not strengths and not improvements and not proverbs:
        return None
    return {"headline": headline, "strengths": strengths, "improvements": improvements, "proverbs": proverbs}


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
    level = body.get("level")  # for reading_generate
    words = body.get("words") or body.get("wordCount")

    if mode == "reading_generate":
        # level can be in body.level or in text like "5"
        lvl = 5
        try:
            if level is not None:
                lvl = int(level)
            else:
                m = re.search(r"\b(\d+)\b", text)
                if m: lvl = int(m.group(1))
        except: lvl = 5
        lvl = max(1, min(10, lvl))
        # words: optional exact word count 10-200
        wc = None
        try:
            if words is not None:
                wc = int(words)
                wc = max(10, min(200, wc))
        except: wc = None
        system = reading_prompt_for_level(lvl, wc)
        user_msg = f"Generate a Level {lvl} paragraph now." + (f" Exactly {wc} words." if wc else "")
        payload = {
            "model": LLM_MODEL,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user_msg}],
            "temperature": 0.8,
            "max_tokens": 500,
            "stream": False,
        }
        if "nemotron" in LLM_MODEL.lower():
            payload["chat_template_kwargs"] = {"enable_thinking": False}
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(f"{LLM_BASE_URL}/chat/completions", json=payload, headers=_llm_headers())
                r.raise_for_status()
                para = r.json()["choices"][0]["message"]["content"].strip()
                # strip quotes / extra formatting
                para = re.sub(r'^["\']|["\']$', '', para).strip()
                # take first paragraph only
                para = para.split("\n\n")[0].strip()
                if not para: raise ValueError("empty")
                return {"paragraph": para, "level": lvl, "llm_ok": True}
        except Exception as e:
            return {"paragraph": None, "level": lvl, "llm_ok": False, "error": f"LLM unreachable ({e.__class__.__name__})"}

    if not text:
        return {"tips": [], "summary": None, "llm_ok": True}

    if mode == "debate":
        system = DEBATE_PROMPT
        max_tokens = 220
    elif mode == "coach_chat":
        system = COACH_CHAT_PROMPT
        max_tokens = 150
    elif mode == "conversation_summary":
        system = TIPS_SUMMARY_PROMPT
        max_tokens = 800
    else:
        system = TIPS_SYSTEM_PROMPT
        max_tokens = 800
    payload = {
        "model": LLM_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": text},
        ],
        "temperature": 0.3,
        "max_tokens": max_tokens,
        "stream": False,
    }
    if "nemotron" in LLM_MODEL.lower():
        payload["chat_template_kwargs"] = {"enable_thinking": False}
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            r = await client.post(
                f"{LLM_BASE_URL}/chat/completions",
                json=payload,
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

    if mode in ("debate", "coach_chat"):
        return {"tips": [], "summary": None, "reply": content.strip(), "llm_ok": True}
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
