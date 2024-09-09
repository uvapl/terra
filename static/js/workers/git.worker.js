let accessToken = null;
XMLHttpRequest.prototype._open = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
  this._open(method, url, async, user, password);
  this.setRequestHeader('Authorization', `Bearer ${accessToken}`);
}

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

    this._init().then(() => {
      options.readyCallback();
    });
  }

  async _init() {
    const lg2mod = await import(new URL('../vendor/lg2.js', import.meta.url));
    this.lg = await lg2mod.default();
    this.fs = this.lg.FS;
    this.fs.writeFile('/home/web_user/.gitconfig',
      `[user]
    name = "Proglab IDE"
    email = ide@proglab.nl`);


    this.clone('http://localhost:5000/kkoomen/ide-test');
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

// // =============================================================================
// // Worker message handling.
// // =============================================================================

let api;

self.onmessage = (event) => {
  switch (event.data.id) {
    case 'constructor':
      api = new API({
        ...event.data.data,

        readyCallback() {
          postMessage({ id: 'ready' });
        },
      });
      break;
  }
};
