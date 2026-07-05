require 'webrick'

class Server < WEBrick::HTTPServer
  # Source files we actively edit. These are served with no-store so the
  # browser never caches them — important for ES module workers, which are
  # otherwise cached very aggressively and keep running stale code across
  # reloads. Large static binaries (e.g. the Pyodide/WASM assets) are left
  # cacheable so they are not re-downloaded on every reload.
  NO_STORE_EXTENSIONS = %w[.js .css .html].freeze

  def service(req, res)
    super
    res['Cross-Origin-Opener-Policy'] = 'same-origin'
    res['Cross-Origin-Embedder-Policy'] = 'require-corp'

    # WEBrick doesn't know the .mjs extension and serves it as
    # application/octet-stream, which browsers reject as an ES module. Pyodide's
    # loader (pyodide.mjs / pyodide.asm.mjs) is imported as a module, so force a
    # JavaScript content type.
    if File.extname(req.path) == '.mjs'
      res['Content-Type'] = 'text/javascript'
    end

    if NO_STORE_EXTENSIONS.include?(File.extname(req.path))
      res['Cache-Control'] = 'no-store'
    end
  end
end

# Serve the repository root, regardless of where this script is run from.
server = Server.new(
  Port: 8000,
  DocumentRoot: File.expand_path('..', __dir__)
)

trap 'INT' do server.shutdown end

server.start
