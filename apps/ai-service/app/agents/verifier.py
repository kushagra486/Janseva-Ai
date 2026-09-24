"""Verifier agent: compare a before photo with an after photo of the same spot.

This is a lightweight visual-change check (perceptual hash distance plus a colour histogram
difference), not proof of a fix. It flags an "after" photo that is nearly identical to the
"before" one, which is the common case of a report being closed without work. The citizen's
confirmation stays the final word.
"""

import io

import numpy as np
from PIL import Image, ImageOps


def _ahash(img: Image.Image, size: int = 16) -> np.ndarray:
    g = ImageOps.grayscale(img).resize((size, size), Image.Resampling.LANCZOS)
    a = np.asarray(g, dtype=np.float32)
    return a > a.mean()


def _hist(img: Image.Image) -> np.ndarray:
    h = np.asarray(img.convert("RGB").resize((128, 128)).histogram(), dtype=np.float32)
    return h / h.sum()


def change_score(before: bytes, after: bytes) -> float:
    """0 = identical, 1 = completely different."""
    b = Image.open(io.BytesIO(before))
    a = Image.open(io.BytesIO(after))
    hash_d = float(np.mean(_ahash(b) != _ahash(a)))
    hist_d = float(0.5 * np.abs(_hist(b) - _hist(a)).sum())
    return round(0.6 * hash_d + 0.4 * hist_d, 3)


def verdict(score: float) -> tuple[str, str]:
    if score < 0.08:
        return "not_fixed", "The after photo looks almost the same as the before photo."
    if score > 0.2:
        return "fixed", "The spot looks visibly different. Please confirm it is fixed."
    return "uncertain", "Small visual change. An officer will take a look."
