class IDEApp extends App {
  setupLayout = () => {
    Terra.layout = this.createLayout();
  }

  postSetupLayout = () => {
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
  }

  onEditorChange = () => {
    Terra.v.blockLFSPolling = true;

    clearTimeout(this.userIsTypingTimeoutId);
    this.userIsTypingTimeoutId = setTimeout(() => {
      Terra.v.blockLFSPolling = false;
    }, Terra.f.seconds(2));
  }

  /**
   * Create the layout object with the given content objects and font-size.
   *
   * @param {boolean} [forceDefaultLayout=false] Whether to force the default layout.
   * @param {Array} [contentConfig=[]] The content configuration for the layout.
   * @returns {Layout} The layout instance.
   */
  createLayout = (forceDefaultLayout = false, contentConfig = []) => {
    const defaultContentConfig = contentConfig.map((tab) => ({
      type: 'component',
      componentName: 'editor',
      componentState: {
        fontSize: Terra.c.BASE_FONT_SIZE,
        ...tab.componentState,
      },
      title: 'Untitled',
      ...tab,
    }))

    const defaultLayoutConfig = {
      settings: {
        showCloseIcon: false,
        showPopoutIcon: false,
        showMaximiseIcon: true,
        reorderEnabled: true,
      },
      dimensions: {
        headerHeight: 30,
        borderWidth: 10,
      },
      content: [
        {
          type: 'column',
          content: [
            {
              type: 'stack',
              content: defaultContentConfig.length > 0 ? defaultContentConfig : [
                {
                  type: 'component',
                  componentName: 'editor',
                  componentState: {
                    fontSize: Terra.c.BASE_FONT_SIZE,
                  },
                  title: 'Untitled',
                },
              ],
            },
            {
              type: 'component',
              componentName: 'terminal',
              componentState: { fontSize: Terra.c.BASE_FONT_SIZE },
              isClosable: false,
              reorderEnabled: false,
            }
          ]
        }
      ]
    };

    return new LayoutIDE(defaultLayoutConfig, { forceDefaultLayout });
  }

}

Terra.app = new IDEApp();
Terra.app.init();
