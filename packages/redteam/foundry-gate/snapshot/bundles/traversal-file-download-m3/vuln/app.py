#!/usr/bin/env python3
"""TeamDocs -- a tiny document download service (VULNERABLE variant).

Planted flaw (CWE-22): the /download endpoint joins the user-supplied
filename to the public documents directory without any sanitization, so
a name containing ../ escapes the public directory and reaches files
outside it (here: secret.txt in the parent directory).
"""
import os
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

MARKER = "FNDRY-TRAV-9E4B71"

PUBLIC_DOCS = {
    "welcome.txt": "Welcome to TeamDocs. Public documents live here.\n",
    "handbook.txt": "Employee handbook: holidays, leave and conduct.\n",
    "canteen-menu.txt": "Canteen menu for this week: soup, salad, pasta.\n",
}

SECRET_TEXT = (
    "INTERNAL - DO NOT DISTRIBUTE\n"
    "Recovery key escrow token: " + MARKER + "\n"
)

BASE_DIR = None
PUBLIC_DIR = None


def setup_files():
    """Create the document tree in a fresh temp dir at startup."""
    global BASE_DIR, PUBLIC_DIR
    BASE_DIR = tempfile.mkdtemp(prefix="teamdocs-")
    PUBLIC_DIR = os.path.join(BASE_DIR, "public")
    os.makedirs(PUBLIC_DIR)
    for name, text in PUBLIC_DOCS.items():
        with open(os.path.join(PUBLIC_DIR, name), "w", encoding="utf-8") as fh:
            fh.write(text)
    # The secret sits OUTSIDE the public directory (its parent).
    with open(os.path.join(BASE_DIR, "secret.txt"), "w", encoding="utf-8") as fh:
        fh.write(SECRET_TEXT)


class Handler(BaseHTTPRequestHandler):
    def _send(self, body, status=200,
              content_type="text/plain; charset=utf-8"):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/":
            listing = "".join(
                '<li><a href="/get?name={0}">{0}</a></li>'.format(name)
                for name in sorted(PUBLIC_DOCS))
            self._send(
                "<!DOCTYPE html><html><head><title>TeamDocs</title></head>"
                "<body><h1>TeamDocs</h1><ul>{}</ul></body></html>".format(
                    listing),
                content_type="text/html; charset=utf-8")
        elif parsed.path == "/get":
            name = parse_qs(parsed.query).get("name", [""])[0]
            # VULNERABILITY: name is joined to the public dir unsanitized,
            # so ../ segments walk out of it.
            path = os.path.join(PUBLIC_DIR, name)
            if name and os.path.isfile(path):
                with open(path, "rb") as fh:
                    self._send(fh.read())
            else:
                self._send("404 Not Found", 404)
        else:
            self._send("404 Not Found", 404)

    def log_message(self, *args):
        pass


def main():
    setup_files()
    port = int(os.environ.get("PORT", "18080"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("READY", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
