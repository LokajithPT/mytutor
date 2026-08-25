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

import time
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

MODEL_SIZE = "small"
LOCAL_DIR = Path(__file__).resolve().parent / "models" / "faster-whisper-small"
MODEL_SOURCE = str(LOCAL_DIR) if (LOCAL_DIR / "model.bin").exists() else MODEL_SIZE

HOST = "127.0.0.1"
PORT = 8100
SAMPLE_RATE = 16000

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


@app.get("/health")
def health() -> dict:
    return {
        "ready": model is not None,
        "model": MODEL_SIZE,
        "source": "local folder" if MODEL_SOURCE == str(LOCAL_DIR) else f"hub:{MODEL_SIZE}",
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT)
