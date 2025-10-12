import { TerraPlugin } from '../../js/plugin-manager.js';
import { createModal, hideModal, showModal } from '../../js/modal.js';
import Terra from '../../js/terra.js';

export default class RunAsPlugin extends TerraPlugin {
  name = 'run-as';

  /**
   * Reference to the file args button element.
   * @type {jQuery.Element}
   */
  $button = jQuery.noop();

  defaultState = {
    compileTarget: null,
    compileSrcFilenames: null,
    args: null,
  }

  onLayoutLoaded = () => {
    this.$button = this.createTermButtonLeft({
      text: `Run as...`,
      id: 'run-as-btn',
      class: '',
      onClick: this.onButtonClick,
      disabled: true,
    });
  }

  onImageShow = (imageComponent) => {
    this.disableButton();
  }

  onEditorFocus = (editorComponent) => {
    if (!this.$button) return;

    if (editorComponent.proglang === 'c') {
      this.enableButton();
    } else {
      this.disableButton();
    }
  }

  enableButton = () => {
    if (!this.$button) return;
    this.$button.prop('disabled', false);
  }

  disableButton = () => {
    if (!this.$button) return;
    this.$button.prop('disabled', true)
  }

  updateCmdPreview = ($modal, activeTabName, defaultTarget) => {
    const args = $modal.find('#file-args-input').val().trim();
    const srcFiles = $modal.find('#compile-src-files-input').val().trim() || activeTabName;
    const target = $modal.find('#compile-target-input').val().replace(/^\.\//, '').trim() || defaultTarget;

    $modal.find('.code-block').html(`
      <div class="line cmd">make ${target}</div>
      <div class="line">clang -ggdb3 -O0 -std=c11 -Wall -Werror -o ${target} ${srcFiles} -lcs50 -lm</div>
      <div class="line cmd">./${target} ${args}</div>
    `);
  }

  validateInputFields = ($modal) => {
    const whitelistedKeys = [
      'Backspace', 'Tab', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
      'Delete', 'Home', 'End'
    ];

    $modal.find('#file-args-input').keydown((event) => {
      if (whitelistedKeys.includes(event.code)) return true;
      if (!/^[a-zA-Z0-9_"'=./ -]$/.test(event.key)) return false;
    });

    $modal.find('#compile-src-files-input').keydown((event) => {
      if (whitelistedKeys.includes(event.code)) return true;
      if (!/^[a-zA-Z0-9_./ -]$/.test(event.key)) return false;
    });

    $modal.find('#compile-target-input').keydown((event) => {
      if (whitelistedKeys.includes(event.code)) return true;
      if (!/^[a-zA-Z0-9_./-]$/.test(event.key)) return false;
    });
  }

  onButtonClick = () => {
    if (this.$button.is(':disabled')) return;

    const editorComponent = Terra.app.layout.getActiveEditor();
    if (!editorComponent || editorComponent.proglang !== 'c') return;

    const activeTabPath = editorComponent.getPath();
    const defaultTarget = editorComponent.getFilename().replace(/\.c$/, '');

    const currentArgs = (this.getState('args') || '').replace(/"/g, '&quot;');
    const currentCompileSrcFiles = this.getState('compileSrcFilenames') || '';
    const currentCompileTarget = this.getState('compileTarget') || '';

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

    this.validateInputFields($modal);

    // Update the preview when the user types in any the input fields.
    this.updateCmdPreview($modal, activeTabPath, defaultTarget);
    $modal.find('input').keyup(() => this.updateCmdPreview($modal, activeTabPath, defaultTarget))

    $modal.find('.cancel-btn').click(() => hideModal($modal));
    $modal.find('.run-btn').click(() => {
      const args = $modal.find('#file-args-input').val().trim();
      const srcFiles = $modal.find('#compile-src-files-input').val().trim() || null;
      const target = $modal.find('#compile-target-input').val().replace(/^\.\//, '').trim() || null;

      this.setState('compileSrcFilenames', srcFiles);
      this.setState('compileTarget', target);
      this.setState('args', args);

      hideModal($modal);
      Terra.app.runCode({ runAs: true });
    });
  }
}
