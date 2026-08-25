"""mytutor speech-to-text service.

Runs faster-whisper locally and serves word-level transcriptions for the
browser app. The model loads once at startup, then each request is a fast
CTranslate2 inference.

Run:
    python -m venv .venv && source .venv/bin/activate   (optional but recommended)
    pip install -r requirements.txt
    python main.py

The browser reaches this through the Vite dev proxy at /api/stt/*.
"""

import numpy as np
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel

MODEL_SIZE = "small"
HOST = "127.0.0.1"
PORT = 8100
SAMPLE_RATE = 16000

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

model: WhisperModel | None = None


@app.on_event("startup")
def load_model() -> None:
    global model
    print(f"Loading Whisper '{MODEL_SIZE}' ...", flush=True)
    model = WhisperModel(MODEL_SIZE, device="auto", compute_type="int8")
    # Warmup so the first real request isn't cold.
    silence = np.zeros(SAMPLE_RATE // 2, dtype=np.float32)
    list(model.transcribe(silence, language="en")[0])
    print("Model ready.", flush=True)


@app.get("/health")
def health() -> dict:
    return {"ready": model is not None, "model": MODEL_SIZE}


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
