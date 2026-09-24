"""Chunk and parse source documents for the knowledge base."""

import re
from dataclasses import dataclass, field


@dataclass
class SourceDoc:
    id: str
    title: str
    body: str
    meta: dict = field(default_factory=dict)

    @property
    def url(self) -> str | None:
        return self.meta.get("source_url")


def parse_frontmatter(text: str) -> tuple[dict, str]:
    """Minimal `key: value` frontmatter between --- lines. Lists are comma-separated."""
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    meta: dict = {}
    for line in text[3:end].strip().splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip().strip('"')
    if "tags" in meta:
        meta["tags"] = [t.strip() for t in meta["tags"].split(",") if t.strip()]
    return meta, text[end + 4:].lstrip()


def chunk_text(body: str, title: str, max_chars: int = 900) -> list[str]:
    """Split on markdown headings, then on paragraphs if a section is too long.

    Each chunk is prefixed with the document title so it stays retrievable on its own.
    """
    sections = re.split(r"\n(?=#{1,3} )", body.strip())
    chunks: list[str] = []
    for sec in sections:
        sec = sec.strip()
        if not sec:
            continue
        if len(sec) <= max_chars:
            chunks.append(sec)
            continue
        buf = ""
        for para in re.split(r"\n\s*\n", sec):
            if buf and len(buf) + len(para) > max_chars:
                chunks.append(buf.strip())
                buf = ""
            buf += para + "\n\n"
        if buf.strip():
            chunks.append(buf.strip())
    return [f"{title}\n{c}" if not c.startswith(title) else c for c in chunks]
