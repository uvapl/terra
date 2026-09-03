#!/usr/bin/env python3
"""Stub course-site backend for testing Terra's connected mode locally.

Serves an exam config from exam-config.json and a lab config from
lab-config.json, and accepts the auto-save POST submissions. Submitted files
are kept in memory and handed back as `tabs` on the next config request, the
way a real course-site restores a student's work. See dev-server/README.md.
"""
import json
import sys
from email.parser import BytesParser
from email.policy import default as email_policy
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

PORT = 8001
HERE = Path(__file__).parent
EXAM_CONFIG_PATH = HERE / 'exam-config.json'
LAB_CONFIG_PATH = HERE / 'lab-config.json'

# Mutable lock state; toggled at runtime via GET /lock and /unlock, or set at
# startup with the --locked flag.
state = {'locked': '--locked' in sys.argv}

# Everything submitted so far, per student code. In memory only, so restarting
# the stub is how you get back to a student's first attempt.
submissions = {}


def parse_submission(headers, body):
    """Pull the code and the files out of a multipart auto-save POST."""
    raw = b'Content-Type: ' + headers.get('Content-Type', '').encode() + b'\r\n\r\n' + body
    message = BytesParser(policy=email_policy).parsebytes(raw)

    code = None
    files = {}
    for part in message.iter_parts():
        filename = part.get_filename()
        payload = part.get_payload(decode=True) or b''
        if filename:
            files[filename] = payload.decode('utf-8', 'replace')
        elif part.get_param('name', header='content-disposition') == 'code':
            code = payload.decode()

    return code, files


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body, content_type='text/plain'):
        body = body.encode()
        self.send_response(status)
        # CORS is required because the page (port 8000) fetches the config
        # cross-origin.
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cross-Origin-Resource-Policy', 'cross-origin')
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)

        if url.path in ('/lock', '/unlock'):
            state['locked'] = url.path == '/lock'
            self._send(200, f"locked = {state['locked']}\n")
            return

        # /lab.json serves the lab config; any other path serves the exam one,
        # so the page URL's `url` param doesn't have to match a specific path.
        path = LAB_CONFIG_PATH if url.path == '/lab.json' else EXAM_CONFIG_PATH
        config = json.loads(path.read_text())

        config['locked'] = state['locked']
        config['postback'] = f'http://localhost:{PORT}/submit'

        # Hand back what this student submitted before, if anything. Without a
        # submission the exam config keeps its template tabs and the lab config
        # keeps none, leaving the lab's own files to fill the session.
        code = parse_qs(url.query).get('code', [None])[0]
        if code in submissions:
            config['tabs'] = submissions[code]

        self._send(200, json.dumps(config), content_type='application/json')

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)

        if state['locked']:
            # Terra's auto-save treats 423 Locked as "submission closed" and
            # locks the entire UI.
            self._send(423, 'locked\n')
            return

        code, files = parse_submission(self.headers, body)
        if code:
            submissions[code] = files

        print(f'Received submission from {code}: {", ".join(files) or "no files"}', flush=True)
        self._send(200, 'ok\n')


if __name__ == '__main__':
    print(f'Course-site stub on http://localhost:{PORT} (locked = {state["locked"]})')
    print(f'  exam config: http://localhost:{PORT}/config.json')
    print(f'  lab config:  http://localhost:{PORT}/lab.json')
    print(f'Toggle the lock with http://localhost:{PORT}/lock and /unlock')
    HTTPServer(('localhost', PORT), Handler).serve_forever()
