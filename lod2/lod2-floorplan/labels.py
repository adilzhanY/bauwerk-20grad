"""
The words written on a floor plan, with where they stand: room names ("Wohnzimmer", "Küche",
"Bad", "Living room"), room numbers, areas. Tesseract reads the drawing in German and English
(a sparse page: words scattered over a plan, not a text block); the editor matches the words
against its dictionary of room names and names each room after the words inside it.

Without Tesseract installed the plan is still read, only without its words.
"""
from __future__ import annotations

import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

# Below this confidence (0 to 100) a word is noise more often than text.
MIN_CONFIDENCE = 35


@dataclass
class Label:
    text: str
    confidence: float
    x: float  # pixels of the image read, the middle of the words
    y: float


def available() -> bool:
    return shutil.which("tesseract") is not None


def read_words(image: Image.Image) -> list[Label]:
    """Lines of words as Tesseract groups them, each with its middle. Empty when Tesseract is missing or too slow."""
    if not available():
        return []
    # Small print on a plan reads better three times the size: a room stamp on a 2400 px A3
    # sheet has 12 px letters, and Tesseract likes about 30.
    scale = 3 if max(image.size) < 2600 else 1
    big = image.convert("L").resize((image.width * scale, image.height * scale), Image.LANCZOS)
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "plan.png"
        big.save(path)
        try:
            out = subprocess.run(
                ["tesseract", str(path), "stdout", "-l", "deu+eng", "--psm", "11", "tsv"],
                capture_output=True, text=True, timeout=120, check=False,
            ).stdout
        except subprocess.TimeoutExpired:
            # A plan whose words take this long is still read, only without them.
            return []
    lines: dict[tuple, list[tuple]] = {}
    for row in out.splitlines()[1:]:
        cells = row.split("\t")
        if len(cells) < 12 or not cells[11].strip():
            continue
        conf = float(cells[10])
        if conf < MIN_CONFIDENCE:
            continue
        key = tuple(cells[1:5])  # page, block, paragraph, line
        left, top, width, height = (int(v) / scale for v in cells[6:10])
        lines.setdefault(key, []).append((left, top, width, height, conf, cells[11].strip()))
    labels = []
    for words in lines.values():
        x0 = min(w[0] for w in words)
        x1 = max(w[0] + w[2] for w in words)
        y0 = min(w[1] for w in words)
        y1 = max(w[1] + w[3] for w in words)
        text = " ".join(w[5] for w in words)
        conf = sum(w[4] for w in words) / len(words)
        labels.append(Label(text, conf, (x0 + x1) / 2, (y0 + y1) / 2))
    return labels
