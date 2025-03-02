Terra.app = new IDEApp();
Terra.app.initLayout().on('initialised', () => {
  // Fetch the repo files or the local storage files (vfs) otherwise.
  const repoLink = Terra.f.getLocalStorageItem('git-repo');
  if (repoLink) {
    Terra.vfs.createGitFSWorker();
  } else {
    Terra.f.createFileTree();
  }

  if (Terra.f.hasLFSApi()) {
    // Enable code for local filesystem.
    $('body').append('<script src="static/js/lfs.js"></script>');
  } else {
    // Disable open-folder if the FileSystemAPI is not supported.
    $('#menu-item--open-folder').remove();
  }

  if (!repoLink && !Terra.f.hasLFSApi()) {
    Terra.f.showLocalStorageWarning();
  }

  $(window).resize();
});

