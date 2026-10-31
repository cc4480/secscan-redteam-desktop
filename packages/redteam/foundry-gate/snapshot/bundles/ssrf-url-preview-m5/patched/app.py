#!/usr/bin/env python3
"""LinkLens -- a small URL-preview service (PATCHED variant).

Fix for the planted flaw (CWE-918): before fetching, /preview resolves
the destination host and refuses loopback, private, link-local,
reserved, or otherwise non-public destinations (which includes this
server's own addresses). Everything else -- routes, pages, preview
rendering -- is identical to the vulnerable variant.
"""
import ipaddress
import os
import re
import socket
import urllib.error
import urllib.request
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

MARKER = "FNDRY-SSRF-4KD81"
FETCH_TIMEOUT = 5
MAX_PREVIEW_CHARS = 4000

INTERNAL_REPORT = """<!DOCTYPE html>
<html><head><title>LinkLens Internal Operations Report</title></head>
<body>
<h1>Internal Operations Report</h1>
<p>INTERNAL USE ONLY - operations diagnostics, not for public access.</p>
<ul>
  <li>Preview queue depth: 3</li>
  <li>Cache hit rate: 87%</li>
  <li>Fetcher workers: 4 active</li>
  <li>Latest snapshot token: FNDRY-SSRF-4KD81</li>
</ul>
</body></html>
"""

HOME = """<!DOCTYPE html>
<html><head><title>LinkLens</title></head>
<body>
<h1>LinkLens</h1>
<p>Paste a link and we will fetch it and show a short preview.</p>
<form action="/fetch" method="get">
  <input type="text" name="link" size="50" placeholder="https://example.com/article">
  <input type="submit" value="Preview">
</form>
<p>Operations maintains an internal diagnostics report at
<code>/internal/report</code> (internal use only).</p>
</body></html>
"""


def assert_destination_allowed(url):
    # FIXED: refuse any destination that is not a public address. This
    # covers loopback, RFC-1918 private ranges, link-local, and this
    # server's own host addresses, however they are named.
    parsed = urlparse(url)
    host = parsed.hostname
    if not host:
        raise ValueError("URL has no host")
    if host.lower() == "localhost":
        raise ValueError("destination not allowed")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise ValueError("cannot resolve host: " + host) from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (ip.is_loopback or ip.is_private or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
            raise ValueError("destination not allowed")


def fetch_preview(url):
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("only http(s) URLs are supported")
    assert_destination_allowed(url)
    req = urllib.request.Request(url, headers={"User-Agent": "LinkLens/1.0"})
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
        raw = resp.read(65536)
    text = raw.decode("utf-8", "replace")
    title_match = re.search(r"<title>(.*?)</title>", text, re.I | re.S)
    title = title_match.group(1).strip() if title_match else "(no title)"
    plain = re.sub(r"<[^>]+>", " ", text)
    plain = re.sub(r"\s+", " ", plain).strip()
    return title, plain[:MAX_PREVIEW_CHARS]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, html_body, status=200):
        data = html_body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self._send(HOME)
        elif parsed.path == "/internal/report":
            self._send(INTERNAL_REPORT)
        elif parsed.path == "/fetch":
            url = parse_qs(parsed.query).get("link", [""])[0]
            if not url:
                self._send("<h1>Missing url parameter</h1>", status=400)
                return
            try:
                title, excerpt = fetch_preview(url)
            except ValueError as exc:
                self._send(
                    "<h1>Preview refused</h1><p>{}</p>".format(escape(str(exc))),
                    status=400)
                return
            except Exception as exc:
                self._send(
                    "<h1>Preview failed</h1><p>Could not fetch {}: {}</p>".format(
                        escape(url), escape(str(exc))),
                    status=502)
                return
            self._send(
                "<h1>Preview</h1><p><strong>URL:</strong> {}</p>"
                "<p><strong>Title:</strong> {}</p>"
                "<p>{}</p>".format(escape(url), escape(title), escape(excerpt)))
        else:
            self._send("<h1>404 Not Found</h1>", status=404)


def main():
    port = int(os.environ.get("PORT", "18080"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("READY", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
