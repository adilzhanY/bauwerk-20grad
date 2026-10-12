"""What the service refuses before any reading starts, and a Tesseract that hangs."""
import importlib
import io
import os
import subprocess

from fastapi.testclient import TestClient
from PIL import Image

import labels


def client():
    os.environ["VISION_KEY"] = ""
    import server

    server = importlib.reload(server)
    server._read_walls = lambda image, outline, job_id: {"walls": []}
    return TestClient(server.app)


def post(image: Image.Image, footprint: str):
    png = io.BytesIO()
    image.save(png, format="PNG")
    return client().post(
        "/walls", files={"plan": ("plan.png", png.getvalue(), "image/png")}, data={"footprint": footprint}
    )


SQUARE = '[{"x":0,"y":0},{"x":10,"y":0},{"x":10,"y":10},{"x":0,"y":10}]'


def test_a_footprint_without_area_is_refused():
    line = '[{"x":0,"y":0},{"x":5,"y":0},{"x":10,"y":0}]'
    assert post(Image.new("RGB", (40, 30), "white"), line).status_code == 422
    assert post(Image.new("RGB", (40, 30), "white"), SQUARE).status_code == 200


def test_an_image_over_40_megapixels_is_refused():
    # 1 bit per pixel, so the test itself stays small: 40.008 megapixels.
    assert post(Image.new("1", (8000, 5001)), SQUARE).status_code == 422


def test_a_tesseract_that_hangs_gives_no_words(monkeypatch):
    def hang(*args, **kwargs):
        raise subprocess.TimeoutExpired(args[0], 120)

    monkeypatch.setattr(labels, "available", lambda: True)
    monkeypatch.setattr(labels.subprocess, "run", hang)
    assert labels.read_words(Image.new("RGB", (40, 30), "white")) == []
