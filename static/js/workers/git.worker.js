// NOTE: The libgit2.js hardcoded a `var wasmBinaryFile = "lg2.wasm"`, so the
// libgit2.js has been modified to use this `wasmBinaryFilePath` variable that
// can now be configured externally in order to make this work.
const wasmBinaryFilePath = '../../wasm/git/libgit2.wasm';

let accessToken = null;
XMLHttpRequest.prototype._open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
  this._open(method, url, async, user, password);
  this.setRequestHeader('Authorization', `Bearer ${accessToken}`);
}

// Libgit will add two global variables:
// - Module: The libgit2 module
// - FS: The filesystem
self.importScripts('../vendor/libgit2.js');


class API {
  /**
   * Contains a reference to the libgit2 filesystem.
   * @type {FS}
   */
  fs = null;

  /**
   * Contains a reference to the libgit2 module.
   * @type {Module}
   */
  lg = null;

  /**
   * The name of the directory where to clone the repo in.
   * @type {string}
   */
  repoDir = 'project';

  constructor(options) {
    accessToken = options.accessToken;
    this.repoLink = options.repoLink;

    this.readyCallback = options.readyCallback;

    this._init();
  }

  async _init() {
    this.lg = await (new Promise(resolve => {
      Module.onRuntimeInitialized = () => {
        console.log('Initialized libgit2 successfully');
        this.readyCallback();
        resolve(Module);
      }
    }));

    this.fs = FS;

    this.clone('http://localhost:5000/kkoomen/ide-test');
    // this.clone('http://localhost:5000/kkoomen/qbr');
  }

  clone(link) {
    console.log('Cloning', link);
    this.lg.callMain(['clone', link, this.repoDir]);
    this.fs.chdir(this.repoDir);
    this.fs.syncfs(false, () => {
      console.log(this.repoDir, 'stored to indexeddb');
    });
    console.log('Dir contents:', this.fs.readdir('.'));

    const filename = 'README.md';
    const filecontents = 'Made through gitfs in uvapl!';
    this.fs.writeFile(filename, filecontents);
    console.log('File contents:', this.fs.readFile(filename));
    console.log('Dir contents:', this.fs.readdir('.'));

    this.lg.callMain(['add', '--verbose', filename]);
    this.lg.callMain(['commit', '-m', `Added ${filename}`]);
    this.lg.callMain(['push']);
  }
}

// =============================================================================
// Worker message handling.
// =============================================================================

let api;
let port;

const onAnyMessage = async event => {
  switch (event.data.id) {
    case 'constructor':
      const { port, ...args } = event.data.data;
      port.onmessage = onAnyMessage;
      api = new API({
        ...args,

        readyCallback() {
          port.postMessage({ id: 'ready' });
        },
      });
      break;

    // EXAMPLE
    // ----------------------------------------
    // case 'runButtonCommand':
    //   api.runButtonCommand(event.data.data);
    //   break;
  }
};

self.onmessage = onAnyMessage;
