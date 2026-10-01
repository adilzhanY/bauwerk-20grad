"""The floor plan service behind a public tunnel: only requests with the shared key get in."""
import importlib
import os

from fastapi.testclient import TestClient


def load(key: str):
    os.environ["VISION_KEY"] = key
    import server

    return importlib.reload(server)


def test_without_the_key_nothing_gets_in():
    client = TestClient(load("s3cret").app)
    assert client.get("/health").status_code == 401
    assert client.get("/health", headers={"x-vision-key": "wrong"}).status_code == 401
    assert client.get("/health", headers={"x-vision-key": "s3cret"}).status_code != 401


def test_without_a_key_set_it_stays_open_on_this_computer():
    client = TestClient(load("").app)
    assert client.get("/health").status_code != 401


if __name__ == "__main__":
    test_without_the_key_nothing_gets_in()
    test_without_a_key_set_it_stays_open_on_this_computer()
    print("floor plan key: all checks passed")
