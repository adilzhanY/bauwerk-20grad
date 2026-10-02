"""An upload in the background: 202 at once, its place asked, its answer collected once."""
import importlib
import io
import os
import time

from fastapi.testclient import TestClient
from PIL import Image


def client():
    os.environ["VISION_KEY"] = ""
    import server

    server = importlib.reload(server)
    # The pipeline itself has its own checks; here only the way the answer travels matters.
    server._read_walls = lambda image, outline, job_id: {"walls": [], "size": list(image.size)}
    return TestClient(server.app)


def upload():
    png = io.BytesIO()
    Image.new("RGB", (40, 30), "white").save(png, format="PNG")
    return {
        "files": {"plan": ("plan.png", png.getvalue(), "image/png")},
        "data": {"footprint": '[{"x":0,"y":0},{"x":10,"y":0},{"x":10,"y":8}]'},
    }


def test_in_the_background():
    c = client()
    res = c.post("/walls", headers={"x-job-id": "job-plan-0001", "prefer": "respond-async"}, **upload())
    assert res.status_code == 202, res.text
    end = time.monotonic() + 3
    while not c.get("/queue/job-plan-0001").json().get("done"):
        assert time.monotonic() < end
        time.sleep(0.02)
    got = c.get("/result/job-plan-0001")
    assert got.status_code == 200 and got.json() == {"walls": [], "size": [40, 30]}
    assert c.get("/result/job-plan-0001").status_code == 404


def test_without_asking_it_answers_directly():
    c = client()
    res = c.post("/walls", headers={"x-job-id": "job-plan-0002"}, **upload())
    assert res.status_code == 200 and res.json()["size"] == [40, 30]


if __name__ == "__main__":
    test_in_the_background()
    test_without_asking_it_answers_directly()
    print("floor plan jobs: all checks passed")
