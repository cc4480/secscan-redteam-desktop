#!/usr/bin/env python3
"""Northwind Pantry -- a small product-search demo shop (PATCHED variant).

Fix for the planted flaw (CWE-89): the /search handler runs its SQLite
query with bound parameters, so the q value is always treated as data,
never as SQL. Everything else -- routes, catalog data, rendering -- is
identical to the vulnerable variant.
"""
import os
import sqlite3
import threading
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

MARKER = "FNDRY-SQLI-7Q2X9"

PRODUCTS = [
    # (name, description, price, visible)
    ("Andean Coffee Beans 1kg",
     "Single-origin arabica beans, medium roast, notes of cocoa and panela.",
     14.50, 1),
    ("Ceramic Pour-Over Dripper",
     "Glazed stoneware dripper for two-cup pour-over brewing.", 22.00, 1),
    ("Cast-Iron Skillet 26cm",
     "Pre-seasoned cast-iron skillet, oven safe to 260C.", 38.75, 1),
    ("Linen Apron - Slate",
     "Heavyweight flax apron with cross-back straps and split pocket.",
     29.90, 1),
    ("Smoked Sea Salt Flakes",
     "Oak-smoked flaky sea salt, 150g jar.", 8.25, 1),
    ("Beeswax Dinner Candles (4)",
     "Hand-dipped beeswax candles, 25cm, unscented.", 16.40, 1),
    ("Walnut Serving Board",
     "Oiled American walnut board with juice groove, 40x25cm.", 44.00, 1),
    ("Stoneware Mug Set (2)",
     "Reactive-glaze stoneware mugs, 350ml each.", 24.60, 1),
    (MARKER + " - QA prototype listing",
     "Internal QA prototype entry for catalog pipeline testing. Not for "
     "sale; kept out of the storefront by the visibility flag.", 0.00, 0),
]


def build_db():
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.execute(
        "CREATE TABLE products (name TEXT, description TEXT, "
        "price REAL, visible INTEGER)"
    )
    conn.executemany("INSERT INTO products VALUES (?, ?, ?, ?)", PRODUCTS)
    conn.commit()
    return conn


CONN = build_db()
DB_LOCK = threading.Lock()


def search_products(q):
    # FIXED: q is bound as a parameter; it can only ever be a search term.
    like = "%" + q + "%"
    with DB_LOCK:
        return CONN.execute(
            "SELECT name, description, price FROM products "
            "WHERE (name LIKE ? OR description LIKE ?) "
            "AND visible = 1 ORDER BY name",
            (like, like),
        ).fetchall()


PAGE = """<!DOCTYPE html>
<html><head><title>Northwind Pantry</title></head>
<body>
<h1>Northwind Pantry</h1>
<p>Small-batch kitchen goods. Search the catalog:</p>
<form action="/search" method="get">
  <input type="text" name="q" value="{q}">
  <input type="submit" value="Search">
</form>
{body}
</body></html>
"""


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
            self._send(PAGE.format(q="", body="<p>Welcome in.</p>"))
        elif parsed.path == "/search":
            q = parse_qs(parsed.query).get("q", [""])[0]
            try:
                rows = search_products(q)
            except sqlite3.Error:
                rows = []
            if rows:
                items = "".join(
                    "<li><strong>{}</strong> - {} (${:.2f})</li>".format(
                        escape(name), escape(desc), price)
                    for name, desc, price in rows
                )
                body = "<p>{} result(s):</p><ul>{}</ul>".format(
                    len(rows), items)
            else:
                body = "<p>No products matched your search.</p>"
            self._send(PAGE.format(q=escape(q, quote=True), body=body))
        else:
            self._send("<h1>404 Not Found</h1>", status=404)


def main():
    port = int(os.environ.get("PORT", "18080"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print("READY", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
