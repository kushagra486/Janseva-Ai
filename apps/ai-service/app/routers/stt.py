from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..deps import User, current_user
from ..llm.base import LLMError
from ..llm.gateway import get_gateway
from ..schemas import SttResponse

router = APIRouter(prefix="/v1", tags=["speech"])


@router.post("/stt", response_model=SttResponse)
async def stt(file: UploadFile = File(...), user: User = Depends(current_user)):
    """Voice note to text with Whisper large-v3 on Groq.

    Local faster-whisper can be plugged in here for offline mode; it is not bundled because
    the model download is large.
    """
    data = await file.read()
    if len(data) > 15 * 1024 * 1024:
        raise HTTPException(413, "Audio too large (max 15 MB)")
    groq = get_gateway().get("groq")
    if groq is None:
        raise HTTPException(503, "Speech to text needs GROQ_API_KEY. Please type instead.")
    try:
        res = await groq.transcribe(data, file.filename or "voice.webm")
    except LLMError as e:
        raise HTTPException(502, "Could not transcribe the voice note. Please try again.") from e
    return SttResponse(text=res["text"], language=res.get("language"), provider="groq")
