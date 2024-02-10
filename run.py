from flask import Flask, send_from_directory
from flask_cors import CORS

app = Flask(__name__)
CORS(app)


@app.route('/')
def index():
    return send_from_directory('.', 'index.html')


@app.route('/static/<path:path>')
def send_static(path):
    return send_from_directory('static', path)


@app.after_request
def add_headers(response):
    response.headers['Cross-Origin-Opener-Policy'] = 'same-origin'
    response.headers['Cross-Origin-Embedder-Policy'] = 'require-corp'
    return response


if __name__ == '__main__':
    app.run(debug=True)
