#!/usr/bin/env python3
"""Probe for xss-reflected-search.

Submits a unique script payload as the search query. Exits 0 iff the exact
payload bytes are observed verbatim (unescaped) in the /search response
body -- i.e. the reflection is exploitable. Exits 1 otherwise (including
when the payload comes back HTML-escaped, as in the patched variant).
"""
import os
import time
import urllib.parse
import urllib.request

PAYLOAD = "<script>FNDRY-XSS-6C50E3</script>"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "foundry-probe"})
    with urllib.request.urlopen(req, timeout=5) as resp:
        return resp.read().decode("utf-8", "replace")


def main():
    base = os.environ.get("BASE_URL", "http://127.0.0.1:18080").rstrip("/")
    url = base + "/search?" + urllib.parse.urlencode({"q": PAYLOAD})
    try:
        body = fetch(url)
    except Exception:
        time.sleep(0.5)  # one retry for startup races
        try:
            body = fetch(url)
        except Exception:
            return 1
    return 0 if PAYLOAD in body else 1


if __name__ == "__main__":
    raise SystemExit(main())
