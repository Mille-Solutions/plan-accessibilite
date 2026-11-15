#!/usr/bin/env python3
"""Serveur de développement : comme `python3 -m http.server`, mais sans cache navigateur,
pour que chaque rechargement (ordinateur ou téléphone) prenne la dernière version des fichiers.
Usage : python3 scripts/serve.py [port]   (écoute sur toutes les interfaces du réseau local)"""
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    http.server.ThreadingHTTPServer(("0.0.0.0", port), NoCacheHandler).serve_forever()
