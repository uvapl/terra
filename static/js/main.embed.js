Terra.app = new EmbedApp();
Terra.app.initLayout().on('initialised', () => {
  // Listen for the content of the file to be received.
  window.addEventListener('message', function(event) {
    const tab = Terra.f.getActiveEditor();
    const editor = tab.instance.editor;
    const fileId = tab.instance.container.getState().fileId;
    const content = Terra.f.removeIndent(event.data);
    if (content) {
      Terra.vfs.updateFile(fileId, { content });
      editor.setValue(content);
      editor.clearSelection();
    }
  });
});
