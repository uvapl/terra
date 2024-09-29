////////////////////////////////////////////////////////////////////////////////
// This file contains the local filesystem logic for the IDE app, using
// https://developer.mozilla.org/en-US/docs/Web/API/File_System_API
////////////////////////////////////////////////////////////////////////////////


class LocalFileSystem {
  async openFile() {
    const [fileHandle] = await window.showOpenFilePicker();

    const file = await fileHandle.getFile();
    const content = await file.text();

    VFS.createFile({ name: file.name, content });
    createFileTree();
  }

  async openFolder() {
    const dirHandle = await window.showDirectoryPicker();
    await this._readFolder(dirHandle, null);
    createFileTree();
  }

  async _readFolder(dirHandle, parentId) {
    for await (const [name, handle] of dirHandle) {
      if (handle.kind === 'file') {
        const file = await handle.getFile();
        const content = await file.text();
        VFS.createFile({ name, content, parentId });
      } else if (handle.kind === 'directory') {
        const folder = VFS.createFolder({ name, parentId });
        await this._readFolder(handle, folder.id);
      }
    }
  }
}

const LFS = new LocalFileSystem();
