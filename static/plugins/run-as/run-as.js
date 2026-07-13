import { TerraPlugin } from '../../js/lib/plugin-manager.js';
import { createModal, hideModal, showModal } from '../../js/ui/components/modal.js';
import Terra from '../../js/terra.js';

export default class RunAsPlugin extends TerraPlugin {
  name = 'run-as';

  /**
   * Reference to the file args button element.
   * @type {HTMLElement|null}
   */
  button = null;

  defaultState = {
    compileTarget: null,
    compileSrcFilenames: null,
    args: null,
  }

  onLayoutLoaded = () => {
    // createTermButtonLeft returns a jQuery-wrapped element (shared plugin
    // infra); unwrap it once so the rest of the plugin stays plain DOM.
    this.button = this.createTermButtonLeft({
      text: `Run as`,
      id: 'run-as-btn',
      class: '',
      onClick: this.onButtonClick,
      disabled: true,
      isAvailable: ({ app, editor }) => {
        if (app.getRunStatus() != "running") {
          return editor?.proglang === 'c'
        }
      },
    })[0];
  }

  updateCmdPreview = (modalEl, activeTabName, defaultTarget) => {
    const args = modalEl.querySelector('#file-args-input').value.trim();
    const srcFiles = modalEl.querySelector('#compile-src-files-input').value.trim() || activeTabName;
    const target = modalEl.querySelector('#compile-target-input').value.replace(/^\.\//, '').trim() || defaultTarget;

    modalEl.querySelector('.code-block').innerHTML = `
      <div class="line cmd">make ${target}</div>
      <div class="line">clang -ggdb3 -O0 -std=c11 -Wall -Werror -o ${target} ${srcFiles} -lcs50 -lm</div>
      <div class="line cmd">./${target} ${args}</div>
    `;
  }

  validateInputFields = (modalEl) => {
    const whitelistedKeys = [
      'Backspace', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
      'Delete', 'Home', 'End'
    ];

    modalEl.querySelector('#file-args-input').addEventListener('keydown', (event) => {
      if (whitelistedKeys.includes(event.code)) return true;
      if (!/^[a-zA-Z0-9_"'=./ -]$/.test(event.key)) return false;
    });

    modalEl.querySelector('#compile-src-files-input').addEventListener('keydown', (event) => {
      if (whitelistedKeys.includes(event.code)) return true;
      if (!/^[a-zA-Z0-9_./ -]$/.test(event.key)) return false;
    });

    modalEl.querySelector('#compile-target-input').addEventListener('keydown', (event) => {
      if (whitelistedKeys.includes(event.code)) return true;
      if (!/^[a-zA-Z0-9_./-]$/.test(event.key)) return false;
    });
  }

  onButtonClick = () => {
    if (this.button.disabled) return;

    const editorComponent = Terra.app.view.getActiveEditor();
    if (!editorComponent || editorComponent.proglang !== 'c') return;

    const activeTabPath = editorComponent.getPath();
    const defaultTarget = editorComponent.getFilename().replace(/\.c$/, '');

    const currentArgs = (this.getState('args') || '').replace(/"/g, '&quot;');
    const currentCompileSrcFiles = this.getState('compileSrcFilenames') || '';
    const currentCompileTarget = this.getState('compileTarget') || '';

    // createModal/showModal/hideModal are shared jQuery-based infra; keep
    // $modal for their calls, but drive our own DOM through modalEl below.
    const $modal = createModal({
      title: 'Run as...',
      body: `
        <div class="form-wrapper-full-width">
          <label>Arguments</label>
          <input type="text" id="file-args-input" class="text-input full-width-input" placeholder="e.g., -X -s --log-level=ERROR" value="${currentArgs}" />
          <p class="text-small">Provide space-separated arguments that will be passed to the file during execution.</p>
        </div>

        <div class="form-wrapper-full-width">
          <label>Source files</label>
          <input type="text" id="compile-src-files-input" class="text-input full-width-input" placeholder="${activeTabPath}" value="${currentCompileSrcFiles}" />
          <p class="text-small">Specify a list of source files to compile, separated by spaces. Leave empty to compile and run the current file.</p>
        </div>

        <div class="form-wrapper-full-width">
          <label>Target</label>
          <input type="text" id="compile-target-input" class="text-input full-width-input" placeholder="${defaultTarget}" value="${currentCompileTarget}" />
          <p class="text-small">Specify the name of the output file (target). Leave blank to use the default based on the current file.</p>
        </div>

        <div class="form-wrapper-full-width">
          <label>Preview</label>
          <div class="code-block"></div>
        </div>
      `,
      footer: `
        <button type="button" class="button cancel-btn">Cancel</button>
        <button type="button" class="button primary-btn run-btn">Run</button>
      `,
      attrs: {
        id: 'terra-plugin-file-args-modal',
        class: 'modal-width-medium',
      }
    });

    showModal($modal);

    const modalEl = $modal[0];

    this.validateInputFields(modalEl);

    // Update the preview when the user types in any the input fields.
    this.updateCmdPreview(modalEl, activeTabPath, defaultTarget);
    modalEl.querySelectorAll('input').forEach((input) => {
      input.addEventListener('keyup', () => this.updateCmdPreview(modalEl, activeTabPath, defaultTarget));
    });

    modalEl.querySelector('.cancel-btn').addEventListener('click', () => hideModal($modal));
    modalEl.querySelector('.run-btn').addEventListener('click', () => {
      const args = modalEl.querySelector('#file-args-input').value.trim();
      const srcFiles = modalEl.querySelector('#compile-src-files-input').value.trim() || null;
      const target = modalEl.querySelector('#compile-target-input').value.replace(/^\.\//, '').trim() || null;

      this.setState('compileSrcFilenames', srcFiles);
      this.setState('compileTarget', target);
      this.setState('args', args);

      hideModal($modal);
      Terra.app.runActiveTab({ runAs: true });
    });
  }
}
