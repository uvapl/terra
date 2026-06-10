#!/usr/bin/env python3
"""Stub exam backend for testing Terra's exam mode locally.

Serves the exam config from exam-config.json (in this directory) and accepts
the auto-save POST submissions. See dev-server/README.md for usage.
"""
import json
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

PORT = 8001
CONFIG_PATH = Path(__file__).parent / 'exam-config.json'

# Mutable lock state; toggled at runtime via GET /lock and /unlock, or set at
# startup with the --locked flag.
state = {'locked': '--locked' in sys.argv}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body, content_type='text/plain'):
        body = body.encode()
        self.send_response(status)
        # CORS is required because the exam page (port 8000) fetches the
        # config cross-origin.
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cross-Origin-Resource-Policy', 'cross-origin')
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ('/lock', '/unlock'):
            state['locked'] = self.path == '/lock'
            self._send(200, f"locked = {state['locked']}\n")
            return

        # Any other path returns the exam config, with the current lock state
        # injected, so the page URL's `url` param doesn't have to match a
        # specific path.
        config = json.loads(CONFIG_PATH.read_text())
        config['locked'] = state['locked']
        config['postback'] = f'http://localhost:{PORT}/submit'
        self._send(200, json.dumps(config), content_type='application/json')

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)

        if state['locked']:
            # Terra's auto-save treats 423 Locked as "submission closed" and
            # locks the entire exam UI.
            self._send(423, 'locked\n')
            return

        print(f'Received submission ({length} bytes)', flush=True)
        self._send(200, 'ok\n')


if __name__ == '__main__':
    print(f'Exam stub on http://localhost:{PORT} (locked = {state["locked"]})')
    print(f'Toggle with http://localhost:{PORT}/lock and /unlock')
    HTTPServer(('localhost', PORT), Handler).serve_forever()
