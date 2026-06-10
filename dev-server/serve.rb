require 'webrick'

class Server < WEBrick::HTTPServer
  def service(req, res)
    super
    res['Cross-Origin-Opener-Policy'] = 'same-origin'
    res['Cross-Origin-Embedder-Policy'] = 'require-corp'
  end
end

# Serve the repository root, regardless of where this script is run from.
server = Server.new(
  Port: 8000,
  DocumentRoot: File.expand_path('..', __dir__)
)

trap 'INT' do server.shutdown end

server.start
