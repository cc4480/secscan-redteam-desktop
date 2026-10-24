#!/usr/bin/env python3
"""DocuFind -- a tiny internal document search service (PATCHED variant).

Fix for CWE-79: the /search endpoint HTML-escapes the user's query before
reflecting it into the results page, so supplied markup is rendered as
inert text. Everything else is identical to the vulnerable variant.
"""
import html
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DOCS = [
    {"title": "Quarterly Planning Guide",
     "body": "Roadmap, milestones and planning notes for the quarter."},
    {"title": "Expense Policy",
     "body": "How to submit expenses, receipts and travel claims."},
    {"title": "Onboarding Checklist",
     "body": "First-week tasks, accounts and buddy assignments for new hires."},
    {"title": "VPN Setup Instructions",
     "body": "Client download, certificate import and connection checks."},
    {"title": "Meeting Room Booking",
     "body": "Room capacities, booking windows and AV equipment notes."},
]

PAGE = """<!DOCTYPE html>
<html><head><title>DocuFind</title></head>
<body>
<h1>DocuFind</h1>
<form action="/lookup" method="get">
<input type="text" name="term" value="">
<input type="submit" value="Search">
</form>
{content}
</body></html>"""


class Handler(BaseHTTPRequestHandler):
    def _send(self, body, status=200):
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self._send(PAGE.format(
                content="<p>Search the internal document index.</p>"))
        elif parsed.path == "/lookup":
            q = parse_qs(parsed.query).get("term", [""])[0]
            if q:
                hits = [d for d in DOCS
                        if q.lower() in d["title"].lower()
                        or q.lower() in d["body"].lower()]
            else:
                hits = DOCS
            items = "".join(
                "<li><b>{}</b> - {}</li>".format(d["title"], d["body"])
                for d in hits)
            # FIX: the reflected query is HTML-escaped before reflection.
            content = "<p>You searched for: {}</p><ul>{}</ul>".format(
                html.escape(q), items)
            self._send(PAGE.format(content=content))
        else:
            self._send("<h1>404 Not Found</h1>", 404)

    def log_message(self, *args):
        pass


def main():
    port = int(os.environ.get("PORT", "18080"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("READY", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
