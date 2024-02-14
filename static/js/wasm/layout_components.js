/*
 * Copyright 2020 WebAssembly Community Group participants
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

window.addEventListener('resize', event => layout.updateSize(window.innerWidth, window.innerHeight));

function getActiveEditor() {
  return layout.root.contentItems[0].contentItems[0].getActiveContentItem();
}

const runCode = debounceLazy(() => {
  const editor = getActiveEditor();
  return api.compileLinkRun(editor.config.title, editor.container.getState().value);
}, 100);

function EditorComponent(container, state) {
  this.editor = ace.edit(container.getElement()[0]);
  this.editor.session.setMode('ace/mode/c_cpp');
  this.editor.setKeyboardHandler('ace/keyboard/sublime');
  this.editor.setOption('fontSize');
  this.editor.setValue(state.value || '');
  this.editor.clearSelection();

  const setFontSize = fontSize => {
    container.extendState({ fontSize });
    this.editor.setFontSize(`${fontSize}px`);
  };

  setFontSize(state.fontSize || 18);

  this.editor.on('change', debounceLazy(event => {
    window._editorIAsDirty = true;
    container.extendState({ value: this.editor.getValue() });
  }, 500));

  container.on('show', () => {
    // Add custom class for styling purposes.
    container.parent.parent.element[0].classList.add('editor-component-container');
  });

  container.on('fontSizeChanged', setFontSize);
  container.on('resize', debounceLazy(() => this.editor.resize(), 20));
  container.on('destroy', () => {
    if (this.editor) {
      this.editor.destroy();
      this.editor = null;
    }
  });
}

let term;
const fitAddon = new FitAddon.FitAddon();
function TerminalComponent(container, state) {
  const setFontSize = fontSize => {
    container.extendState({ fontSize });
    term.options.fontSize = fontSize;
    fitAddon.fit();
  };

  container.on('open', () => {
    // Add custom class for styling purposes.
    container.parent.parent.element[0].classList.add('terminal-component-container');

    const fontSize = state.fontSize || 18;

    term = new Terminal({
      convertEol: true,
      disableStdin: true,
      fontSize,
      lineHeight: 1.2
    })
    term.loadAddon(fitAddon);
    term.open(document.querySelector('.terminal-component-container .lm_content'));
    fitAddon.fit();

    startingMessage = [
      'Click the "run" button to execute code',
      'Click the "clear terminal" to clear this terminal screen',
    ];
    for (const line of startingMessage) {
      term.write(line + '\n');
    }
    term.write('\n');
    term.open(container.getElement()[0]);
    setFontSize(fontSize);
  });

  container.on('fontSizeChanged', setFontSize);
  container.on('resize', debounceLazy(() => fitAddon.fit(), 20));
  container.on('destroy', () => {
    if (term) {
      term.destroy();
      term = null;
    }
  });
}

class Layout extends GoldenLayout {
  createdControls = false;

  constructor(options) {
    let layoutConfig = getLocalStorageItem('layout');
    if (layoutConfig) {
      layoutConfig = JSON.parse(layoutConfig);
    } else {
      layoutConfig = options.defaultLayoutConfig;
    }

    super(layoutConfig, $('#layout'));

    this.on('stateChanged', debounceLazy(() => {
      const config = this.toConfig();
      const state = JSON.stringify(config);
      localStorage.setItem(options.configKey, state);
    }, 500));

    this.on('stackCreated', stack => {
      if (!this.createdControls) {
        // Do a set-timeout trick to make sure the components are registered
        // through the registerComponent() function, prior to calling this part.
        setTimeout(this.createControls, 0);

        this.createdControls = true;
      }
    });

    this.registerComponent('editor', EditorComponent);
    this.registerComponent('terminal', TerminalComponent);
  }

  createControls() {
    // Add the buttons to the header.
    $('.editor-component-container .lm_header').append('<ul class="lm_controls"><button id="run" class="button run-code-btn">Run</button></ul>');
    $('.terminal-component-container .lm_header').prepend('<button id="clear-term" class="button clear-term-btn">Clear terminal</button>');

    // Add event listeners.
    $('#run').click((event) => {
      const $button = $(event.target);
      if ($button.prop('disabled')) return;

      $button.prop('disabled', true);
      runCode().then(() => {
        $button.prop('disabled', false);
      });
    });
    $('#clear-term').click(() => term.clear());
  }
}

class WorkerAPI {
  constructor() {
    this.nextResponseId = 0;
    this.responseCBs = new Map();
    this.worker = new Worker('static/js/worker.js');
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = this.onmessage.bind(this);

    const remotePort = channel.port2;
    this.worker.postMessage({ id: 'constructor', data: remotePort },
      [remotePort]);
  }

  terminate() {
    this.worker.terminate();
  }

  async runAsync(id, options) {
    const responseId = this.nextResponseId++;
    const responsePromise = new Promise((resolve, reject) => {
      this.responseCBs.set(responseId, { resolve, reject });
    });
    this.port.postMessage({ id, responseId, data: options });
    return await responsePromise;
  }

  compileLinkRun(filename, contents) {
    this.port.postMessage({
      id: 'compileLinkRun',
      data: { filename, contents },
    });
  }

  onmessage(event) {
    switch (event.data.id) {
      case 'write':
        term.write(event.data.data);
        break;

      case 'runAsync': {
        const responseId = event.data.responseId;
        const promise = this.responseCBs.get(responseId);
        if (promise) {
          this.responseCBs.delete(responseId);
          promise.resolve(event.data.data);
        }
        break;
      }
    }
  }
}

const api = new WorkerAPI();

// TODO: uncomment this to enable caching
// ======================================
// if (navigator.serviceWorker) {
//   navigator.serviceWorker.register('/static/js/service_worker.js')
//     .then(reg => {
//       console.log('Registration succeeded. Scope is ' + reg.scope);
//     }).catch(error => {
//       console.log('Registration failed with ' + error);
//     });
// }
