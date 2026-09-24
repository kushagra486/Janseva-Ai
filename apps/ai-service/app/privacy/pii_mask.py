"""Mask personal identifiers before any text leaves this service for a hosted model.

Masks Aadhaar numbers (12 digits, optionally grouped 4-4-4, first digit 2-9), Indian mobile
numbers (optional +91/0 prefix, 10 digits starting 6-9), PAN, email addresses, and
Aadhaar Virtual IDs (16 digits). Devanagari digits are handled too.
"""

import re

_DEV_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")

_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("VID", re.compile(r"(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)")),
    ("AADHAAR", re.compile(r"(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d)")),
    ("PHONE", re.compile(r"(?<![\d+])(?:\+91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?!\d)")),
    ("PAN", re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")),
    ("EMAIL", re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")),
]


def to_ascii_digits(text: str) -> str:
    return text.translate(_DEV_DIGITS)


def mask_pii(text: str) -> tuple[str, dict[str, int]]:
    """Returns (masked_text, counts_by_kind)."""
    out = to_ascii_digits(text)
    counts: dict[str, int] = {}
    for kind, pat in _PATTERNS:
        out, n = pat.subn(f"[{kind}]", out)
        if n:
            counts[kind] = n
    return out, counts
