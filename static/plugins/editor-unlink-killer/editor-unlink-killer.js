/*
 * This plugin automatically disables the IDE if we detect that
 * a tab is linked to a fileID that cannot be found in the VFS (anymore).
 */

import Terra from '../../js/terra.js';
import { createModal, showModal } from '../../js/modal.js';
import { TerraPlugin } from '../../js/plugin-manager.js';

export default class EditorUnlinkKiller extends TerraPlugin {
  constructor() {
    super();
    this.name = 'tab-watcher';
    this.interval = 10000; // 10 seconds
    this.startWatching();
    console.log("Started unlink KILLER");
  }

  startWatching() {
    setInterval(() => {
      this.checkTabs();
    }, this.interval);
  }

  checkTabs() {
    const editorComponents = Terra.app.layout.getEditorComponents();
    editorComponents.forEach((editorComponent) => {
      if (editorComponent.getFilename() === 'Untitled') return;

      const { fileId } = editorComponent.getState();
      if (!this.isValidFileId(fileId)) {
        console.error(`Invalid file ID detected: ${fileId}`);
        this.disableIDE(`The tab you were editing could not be saved. But whatever was
                         there 10 seconds ago should still be saved, so please try to
                         reload.`);
      }
    });
  }

  isValidFileId(fileId) {
    return !!Terra.app.vfs.findFileById(fileId);
  }

  disableIDE(errorMessage) {
    // Disable all ace editors
    const editorComponents = Terra.app.layout.getEditorComponents();
    editorComponents.forEach((editorComponent) => {
      editorComponent.lock();
    });

    // Disable the file tree
    $('#file-tree').addClass('disabled');

    // Show a modal that disallows input anywhere in the IDE
    const $modal = createModal({
      title: 'IDE Disabled',
      body: `<p>${errorMessage}</p>`,
      footer: '',
      attrs: {
        id: 'ide-disabled-modal',
        class: 'modal-width-small'
      }
    });

    showModal($modal);
  }
}
