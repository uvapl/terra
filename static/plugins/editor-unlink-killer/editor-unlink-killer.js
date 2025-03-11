/*
 * This plugin automatically disables the IDE if we detect that
 * a tab is linked to a fileID that cannot be found in the VFS (anymore).
 */

class EditorUnlinkKiller extends TerraPlugin {
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
    const tabs = Terra.f.getAllEditorTabs();
    tabs.forEach((tab) => {
      const fileId = tab.container.getState().fileId;
      if (!this.isValidFileId(fileId)) {
        console.error(`Invalid file ID detected: ${fileId}`);
        this.disableIDE(`The tab you were editing could not be saved. But whatever's was there 10 seconds ago should still be saved, so please try to reload.`);
      }
    });
  }

  isValidFileId(fileId) {
    if (Terra.f.hasLFS() && Terra.lfs.loaded) {
      return !!Terra.vfs.findFileById(fileId);
    } else if (Terra.f.hasGitFSWorker()) {
      return !!Terra.vfs.findFileById(fileId);
    } else {
      return !!Terra.vfs.findFileById(fileId);
    }
  }

  disableIDE(errorMessage) {
    // Disable all ace editors
    const tabs = Terra.f.getAllEditorTabs();
    tabs.forEach((tab) => {
      tab.instance.editor.setReadOnly(true);
    });

    // Disable the file tree
    $('#file-tree').addClass('disabled');

    // Show a modal that disallows input anywhere in the IDE
    const $modal = Terra.f.createModal({
      title: 'IDE Disabled',
      body: `<p>${errorMessage}</p>`,
      footer: '',
      attrs: {
        id: 'ide-disabled-modal',
        class: 'modal-width-small'
      }
    });

    Terra.f.showModal($modal);
  }
}

(() => Terra.pluginManager.register(new EditorUnlinkKiller()))();
