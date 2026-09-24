"""Read text from a notice: plain text, digital PDF, or photo.

Photos go through OpenCV preprocessing (grayscale, denoise, adaptive threshold, deskew) and
Tesseract with the Hindi + English packs. Both are optional imports so the service still runs
(text and digital-PDF input only) where they are not installed. A hosted vision model can be
used as a last resort when ALLOW_VISION_FALLBACK=true.
"""

import base64
import io
import logging
from dataclasses import dataclass

import httpx
from PIL import Image

from ..config import get_settings

log = logging.getLogger(__name__)


@dataclass
class OcrResult:
    text: str
    engine: str
    quality: float  # 0..1 rough confidence that the text is usable


class OcrError(Exception):
    pass


def _tesseract():
    try:
        import pytesseract
        pytesseract.get_tesseract_version()
        return pytesseract
    except Exception:  # noqa: BLE001 - missing binary raises various errors
        return None


def preprocess(img: Image.Image):
    """Returns a cleaned binary image (numpy array) ready for OCR."""
    import cv2
    import numpy as np

    arr = np.array(img.convert("RGB"))
    gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    h, w = gray.shape
    if max(h, w) < 1600:  # upscale small phone photos; Tesseract likes ~300 dpi
        scale = 1600 / max(h, w)
        gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    gray = cv2.fastNlMeansDenoising(gray, h=15)
    binary = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                   cv2.THRESH_BINARY, 31, 15)
    coords = np.column_stack(np.where(binary < 128))
    if len(coords) > 100:
        angle = cv2.minAreaRect(coords.astype(np.float32))[-1]
        angle = angle - 90 if angle > 45 else angle
        if 0.5 < abs(angle) < 15:
            h2, w2 = binary.shape
            m = cv2.getRotationMatrix2D((w2 / 2, h2 / 2), angle, 1.0)
            binary = cv2.warpAffine(binary, m, (w2, h2), flags=cv2.INTER_CUBIC,
                                    borderMode=cv2.BORDER_REPLICATE)
    return binary


def _ocr_image(img: Image.Image) -> OcrResult | None:
    tess = _tesseract()
    if tess is None:
        return None
    try:
        prepared = preprocess(img)
    except ImportError:
        prepared = img.convert("L")
    data = tess.image_to_data(prepared, lang="hin+eng", output_type=tess.Output.DICT)
    words = [(w, float(c)) for w, c in zip(data["text"], data["conf"], strict=False) if w.strip()]
    text = tess.image_to_string(prepared, lang="hin+eng")
    confs = [c for _, c in words if c >= 0]
    quality = (sum(confs) / len(confs) / 100) if confs else 0.0
    return OcrResult(text.strip(), "tesseract", round(quality, 2))


async def _vision_ocr(img: Image.Image) -> OcrResult | None:
    s = get_settings()
    if not (s.allow_vision_fallback and s.groq_api_key):
        return None
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=85)
    b64 = base64.b64encode(buf.getvalue()).decode()
    body = {
        "model": s.groq_vision_model,
        "temperature": 0,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": "Transcribe all text in this government notice exactly, "
                                     "in its original language. Output only the text."},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
        ]}],
    }
    try:
        async with httpx.AsyncClient(timeout=40) as client:
            r = await client.post("https://api.groq.com/openai/v1/chat/completions", json=body,
                                  headers={"Authorization": f"Bearer {s.groq_api_key}"})
            r.raise_for_status()
            text = r.json()["choices"][0]["message"]["content"]
            return OcrResult(text.strip(), "vision-llm", 0.75)
    except (httpx.HTTPError, KeyError) as e:
        log.warning("vision OCR failed: %s", e)
        return None


def _pdf_text(data: bytes) -> tuple[str, list[Image.Image]]:
    try:
        import pypdfium2 as pdfium
    except ImportError as e:
        raise OcrError("PDF support needs pypdfium2 (requirements-ocr.txt)") from e
    pdf = pdfium.PdfDocument(data)
    texts, images = [], []
    for i in range(min(len(pdf), 5)):
        page = pdf[i]
        texts.append(page.get_textpage().get_text_range())
        images.append(page.render(scale=2.5).to_pil())
    return "\n".join(texts).strip(), images


async def read_notice(data: bytes, content_type: str) -> OcrResult:
    if content_type.startswith("text/"):
        return OcrResult(data.decode("utf-8", errors="replace").strip(), "text", 1.0)

    if content_type == "application/pdf":
        text, pages = _pdf_text(data)
        if len(text) > 40:
            return OcrResult(text, "pdf-text", 0.95)
        results = [r for p in pages if (r := _ocr_image(p))]
        if results:
            return OcrResult("\n".join(r.text for r in results), "tesseract",
                             min(r.quality for r in results))
        raise OcrError("Scanned PDF but no OCR engine is installed")

    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception as e:  # noqa: BLE001
        raise OcrError("Could not read the image. Please retake the photo.") from e

    result = _ocr_image(img)
    if result and len(result.text) >= 30 and result.quality >= 0.45:
        return result
    vision = await _vision_ocr(img)
    if vision:
        return vision
    if result:
        return result
    raise OcrError("No OCR engine available. Install Tesseract (hin+eng) or paste the text.")
