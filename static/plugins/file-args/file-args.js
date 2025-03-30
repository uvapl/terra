import { TerraPlugin } from '../../js/plugin-manager.js';
import { getActiveEditor } from '../../js/helpers/editor-component.js';
import { createModal, hideModal, showModal } from '../../js/modal.js';
import VFS from '../../js/vfs.js';
import pluginManager from '../../js/plugin-manager.js';

export default class FileArgsPlugin extends TerraPlugin {
  name = 'file-args';
  css = ['static/plugins/check50/check50.css'];

  /**
   * Reference to the file args button element.
   * @type {jQuery.Element}
   */
  $button = jQuery.noop();

  defaultState = {
    // Example key-value pairs:
    // 'absolute/folder/path/to/foo.c': '-X -f -c'
    fileargs: {},
  }

  onLayoutLoaded = () => {
    this.$button = this.createTermButtonLeft({
      text: 'Arguments',
      id: 'file-args-btn',
      class: '',
      onClick: this.onButtonClick,
      disabled: true,
    });
  }

  onEditorFocus = (editorComponent) => {
    if (!this.$button) return;

    if (editorComponent.proglang === 'c') {
      this.enableButton();
    } else {
      this.disableButton();
    }
  }

  onStorageChange = (storageName, prevStorageName) => {
    // We don't want to clear the storage when the user reloads the page and
    // was already using a certain filesystem (gitfs/LFS) before reloading.
    // The state should only be cleared when switching storages after
    // reloading the page.
    if (prevStorageName && storageName !== prevStorageName) {
      this.clearState('fileargs');
    }
  }

  enableButton = () => {
    this.$button.prop('disabled', false);
  }

  disableButton = () => {
    this.$button.prop('disabled', true)
  }

  onButtonClick = () => {
    if (this.$button.is(':disabled')) return;

    const tab = getActiveEditor();
    if (!tab || tab.instance.proglang !== 'c') return;

    const fileId = tab.container.getState().fileId;
    const filepath = VFS.getAbsoluteFilePath(fileId);

    const currentArgs = (this.getState('fileargs')[filepath] || '').replace(/"/g, '&quot;');

    const $modal = createModal({
      title: 'Enter file arguments',
      body: `
      <p>Enter the arguments to be passed for the current file in the input field below.</p>
      <input type="text" class="text-input full-width-input file-args" placeholder="e.g. -X -s --log-level=ERROR" value="${currentArgs}" />
      `,
      footer: `
        <button type="button" class="button cancel-btn">Cancel</button>
        <button type="button" class="button primary-btn">Confirm</button>
      `,
      attrs: {
        id: 'terra-plugin-file-args-modal',
        class: 'modal-width-small',
      }
    });

    showModal($modal);

    $modal.find('.cancel-btn').click(() => hideModal($modal));
    $modal.find('.primary-btn').click(() => {
      const args = $modal.find('.file-args').val();
      this.setState('fileargs', {
        ...this.getState('fileargs'),
        [filepath]: args
      });
      hideModal($modal)
    });
  }
}
