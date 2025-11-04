import os
from typing import List, Optional
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx


OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")


class Message(BaseModel):
    role: str  # 'user' or 'assistant'
    content: str


class ChatRequest(BaseModel):
    messages: List[Message]
    user_input: str


class ChatResponse(BaseModel):
    reply: str
    from: str  # 'openai' or 'local'


app = FastAPI(title="Calm AI Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"]
    ,allow_headers=["*"]
)


CRISIS_PATTERN = (
    "suicide", "kill myself", "end my life", "self harm", "self-harm", "overdose"
)


def detect_emotion(text: str) -> str:
    s = text.lower()
    def has(keys):
        return any(k in s for k in keys)
    if has(["anxious","panic","nervous","worry","overwhelmed","stress"]):
        return "anxiety"
    if has(["sad","down","empty","cry","alone","lonely","depress"]):
        return "sadness"
    if has(["angry","mad","furious","hate","resent"]):
        return "anger"
    if has(["guilty","my fault","blame myself","ashamed","shame"]):
        return "guilt"
    if has(["hopeless","no point","nothing matters"]):
        return "hopeless"
    return "neutral"


def local_reply(user_input: str) -> str:
    if any(k in user_input.lower() for k in CRISIS_PATTERN):
        return (
            "I'm really glad you told me. If you're in immediate danger, call your local "
            "emergency number now. You can also reach a hotline: "
            "https://www.opencounseling.com/suicide-hotlines"
        )
    emotion = detect_emotion(user_input)
    validations = {
        "sadness": "That sounds really heavy. It's okay to feel this way.",
        "anxiety": "That sounds tense and overwhelming. Your nervous system is working hard.",
        "anger": "It makes sense you'd feel upset given what happened.",
        "guilt": "You're being hard on yourself; that shows you care.",
        "hopeless": "When things feel stuck, hope can feel far away—and that's understandable.",
        "neutral": "Thanks for sharing what's going on.",
    }
    strategies = {
        "sadness": "Try a two‑minute activation: stand, stretch, sip water.",
        "anxiety": "Try 4‑6 breathing: inhale 4, hold 2, exhale 6 ×4.",
        "anger": "Quick body scan—jaw, shoulders, hands—soften on the exhale.",
        "guilt": "Ask: what would you gently tell a close friend in this?",
        "hopeless": "List one thing slightly in your control today.",
        "neutral": "What small outcome would feel 1% better?",
    }
    questions = {
        "sadness": "What’s one small comfort you can offer yourself right now?",
        "anxiety": "What’s the specific worry repeating in your mind?",
        "anger": "What boundary or value felt crossed?",
        "guilt": "What evidence supports a kinder interpretation?",
        "hopeless": "What tiny step is doable in under 2 minutes?",
        "neutral": "What would you like to be different by tonight?",
    }
    prefix = f"Thanks for sharing. It sounds like: “{user_input[:160]}”."
    return f"{prefix} {validations[emotion]} {strategies[emotion]} {questions[emotion]}"


async def openai_reply(history: List[Message], user_input: str) -> Optional[str]:
    if not OPENAI_API_KEY:
        return None
    sys = (
        "You are a supportive, concise mental health assistant using CBT and motivational "
        "interviewing. Be validating, practical, and safe. Avoid diagnosing. Provide brief, "
        "actionable steps and one reflective question. If crisis language is present, advise "
        "immediate local help and hotlines without giving medical instructions."
    )
    payload = {
        "model": OPENAI_MODEL,
        "messages": ([{"role": "system", "content": sys}] +
                     [{"role": m.role, "content": m.content} for m in history[-10:]] +
                     [{"role": "user", "content": user_input}]),
        "temperature": 0.7
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        if r.status_code != 200:
            return None
        j = r.json()
        return (j.get("choices", [{}])[0]
                  .get("message", {})
                  .get("content", "")).strip() or None


@app.post("/api/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    # Try OpenAI first (if key configured); otherwise local empathy engine
    ai = await openai_reply(req.messages, req.user_input)
    if ai:
        return ChatResponse(reply=ai, from="openai")
    return ChatResponse(reply=local_reply(req.user_input), from="local")


@app.get("/")
def root():
    return {"ok": True, "service": "Calm AI Backend"}


