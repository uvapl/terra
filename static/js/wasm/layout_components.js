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

let editor;
const run = debounceLazy(editor => {
  return api.compileLinkRun(editor.getValue());
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
    container.extendState({ value: this.editor.getValue() });
  }, 500));

  container.on('show', () => {
    // Update the current editor.
    editor = this.editor;

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
Terminal.applyAddon(fit);
function TerminalComponent(container, state) {
  const setFontSize = fontSize => {
    container.extendState({ fontSize });
    term.setOption('fontSize', fontSize);
    term.fit();
  };

  container.on('open', () => {
    // Add custom class for styling purposes.
    container.parent.parent.element[0].classList.add('terminal-component-container');

    // Set font-size.
    const fontSize = state.fontSize || 18;
    term = new Terminal({ convertEol: true, disableStdin: true, fontSize });
    term.open(container.getElement()[0]);
    setFontSize(fontSize);
  });

  container.on('fontSizeChanged', setFontSize);
  container.on('resize', debounceLazy(() => term.fit(), 20));
  container.on('destroy', () => {
    if (term) {
      term.destroy();
      term = null;
    }
  });
}

class Layout extends GoldenLayout {
  createdRunBtn = false;

  constructor(options) {
    // let layoutConfig = localStorage.getItem(options.configKey);
    // if (layoutConfig) {
    //   layoutConfig = JSON.parse(layoutConfig);
    // } else {
    //   layoutConfig = options.defaultLayoutConfig;
    // }
    const layoutConfig = options.defaultLayoutConfig;

    super(layoutConfig, $('#layout'));

    this.on('stateChanged', debounceLazy(() => {
      const config = this.toConfig();
      const state = JSON.stringify(config);
      localStorage.setItem(options.configKey, state);
    }, 500));

    this.on('stackCreated', stack => {
      this.setActiveEditor(stack);

      if (!this.createdRunBtn) {
        this.createRunBtn();
        this.createdRunBtn = true;
      }
    });

    this.registerComponent('editor', EditorComponent);
    this.registerComponent('terminal', TerminalComponent);
  }

  setActiveEditor(stack) {
    // Set first editor component to be the active one.
    if (!editor) {
      editor = stack.contentItems[0].instance.editor;
    }
  }

  createRunBtn() {
    const runBtn = document.createElement('button');
    $('.lm_header').first().append('<ul class="lm_controls"><button id="run" class="run-code-btn">Run</button></ul>');
    $('#run').click(() => run(editor));
  }
}

class WorkerAPI {
  constructor() {
    this.nextResponseId = 0;
    this.responseCBs = new Map();
    this.worker = new Worker('/static/js/worker.js');
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

  compileLinkRun(contents) {
    this.port.postMessage({ id: 'compileLinkRun', data: contents });
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
