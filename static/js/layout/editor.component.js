/**
 * Editor component for GoldenLayout.
 */
class EditorComponent {
  /**
   * Component container object.
   * @type {GoldenLayout.ItemContainer}
   */
  container = null;

  /**
   * Initialization state.
   * @type {object}
   */
  state = null;

  /**
   * Instance of the editor for the current tab.
   * @type {Ace.Editor}
   */
  editor = null;

  /**
   * Whether the onContainerOpen event has been triggered falsely.
   * This happens when there is a single empty Untitled tab where the user
   * clicks on the left-sidebar to open another file. At this moment, the
   * Untitled tab will be closed, however, GoldenLayout switches to the Untitled
   * tab, closes it and then switches back to the newly inserted tab, which
   * triggers another 'show' event, which leads to code being run twice and thus
   * leading in an unexpected onfilechange event triggered, while the only thing
   * that the user did was open file.
   */
  fakeOnContainerOpenEvent = false;

  constructor(container, state) {
    this.container = container;
    this.state = state;

    this.init();
  }

  init = () => {
    this.bindContainerEvents();
    this.initEditor();
    this.bindEditorCommands();
    this.bindEditorEvents();

    this.setTheme(Terra.f.getLocalStorageItem('theme') || 'light');
    this.setFontSize(this.state.fontSize || Terra.c.BASE_FONT_SIZE);

    // Set the proglang, or use 'text' as the filetype if there's no file ext.
    const filename = this.container.parent.config.title;
    const proglang = filename.includes('.') ? Terra.f.getFileExtension(filename) : 'text';
    this.setProgLang(proglang);
  }

  /**
   * Initialize the editor instance, including rendering it in the DOM.
   */
  initEditor = () => {
    // To make sure GoldenLayout doensn't override the editor styles, we create
    // another child container for the editor instance.
    const contentContainer = this.container.getElement()[0];
    const editorContainer = document.createElement('div');
    editorContainer.classList.add('editor');
    contentContainer.appendChild(editorContainer);

    this.editor = ace.edit(editorContainer);
    this.editor.setKeyboardHandler('ace/keyboard/sublime');
    this.editor.setOption('fontSize');
    this.editor.setOption('enableSnippets', false);
    this.editor.setOption('enableBasicAutocompletion', true);
    this.editor.setOption('enableLiveAutocompletion', true);
    this.editor.setValue(this.state.value || '');
    this.editor.clearSelection();
    this.editor.completers = Terra.f.getAceCompleters();
  }

  /**
   * Bind all custom editor commands.
   */
  bindEditorCommands = () => {
    this.editor.commands.addCommand({
      name: 'run',
      bindKey: { win: 'Ctrl+Enter', mac: 'Command+Enter' },
      exec: () => Terra.f.runCode(),
    });

    this.editor.commands.addCommand({
      name: 'save',
      bindKey: { win: 'Ctrl+S', mac: 'Command+S' },
      exec: () => {
        if (Terra.c.IS_IDE) {
          Terra.f.saveFile();
        }
      }
    });

    this.editor.commands.addCommand({
      name: 'moveLinesUp',
      bindKey: { win: 'Ctrl+Alt+Up', mac: 'Command+Option+Up' },
      exec: () => this.editor.moveLinesUp(),
    });

    this.editor.commands.addCommand({
      name: 'moveLinesDown',
      bindKey: { win: 'Ctrl+Alt+Down', mac: 'Command+Option+Down' },
      exec: () => this.editor.moveLinesDown(),
    });

    if (Terra.c.IS_IDE) {
      this.bindEditorIDECommands();
    }

    if (Terra.f.hasLFSApi()) {
      this.bindEditorLFSCommands();
    }
  }

  /**
   * Bind all editor comments specific to the IDE.
   */
  bindEditorIDECommands = () => {
    this.editor.commands.addCommand({
      name: 'closeFile',
      bindKey: 'Ctrl+W',
      exec: () => Terra.f.closeFile(),
    });

    this.editor.commands.addCommand({
      name: 'createNewFileTreeFile',
      bindKey: 'Ctrl+T',
      exec: () => Terra.f.createNewFileTreeFile(),
    });

    this.editor.commands.addCommand({
      name: 'createNewFileTreeFolder',
      bindKey: 'Ctrl+Shift+T',
      exec: () => Terra.f.createNewFileTreeFolder(),
    });
  }

  /**
   * Bind all editor commands specific to the LFS when the LFS API is enabled.
   */
  bindEditorLFSCommands = () => {
    this.editor.commands.on('exec', (e) => {
      if (Terra.f.hasLFS() && Terra.lfs.loaded && ['paste', 'insertstring'].includes(e.command.name)) {
        const inputText = e.args.text || '';
        const filesize = new Blob([this.editor.getValue() + inputText]).size;
        if (filesize >= Terra.c.LFS_MAX_FILE_SIZE) {
          // Prevent the event from happening.
          e.preventDefault();

          const $modal = createModal({
            title: 'Exceeded maximum file size',
            body: 'The file size exceeds the maximum file size. This limit is solely required when you are connected to your local filesystem. Please reduce the file size beforing adding more content.',
            footer: ' <button type="button" class="button primary-btn confirm-btn">Go back</button>',
            footerClass: 'flex-end',
            attrs: {
              id: 'ide-exceeded-file-size-modal',
              class: 'modal-width-small',
            }
          });

          showModal($modal);
          $modal.find('.confirm-btn').click(() => hideModal($modal));
        }
      }
    });
  }

  /**
   * Callback when the editor is loaded.
   */
  onEditorLoad = () => {
    this.editor.getSession().getUndoMananger().reset();
    if (Terra.c.IS_IDE) {
      Terra.pluginManager.call('onEditorLoad', this.editor);
    }
  }

  /**
   * Callback when the editor content changes, triggered per keystroke.
   */
  onEditorChange = () => {
    Terra.v.blockLFSPolling = true;
    Terra.v.editorIsDirty = true;
    this.container.extendState({ value: this.editor.getValue() });

    const { fileId } = this.container.getState();
    if (fileId && !Terra.c.IS_IFRAME) {
      Terra.vfs.updateFile(fileId, {
        content: this.editor.getValue(),
      });
    }

    clearTimeout(this.userIsTypingTimeoutId);
    this.userIsTypingTimeoutId = setTimeout(() => {
      Terra.v.blockLFSPolling = false;
    }, Terra.f.seconds(2));
  }

  /**
   * Callback when the user's cursor is focused on the editor.
   */
  onEditorFocus = () => {
    this.setActiveEditor();

    // Spawn a new worker if necessary.
    createLangWorkerApi(this.proglang);
  }

  /**
   * Callback when the editor container is opened.
   */
  onContainerOpen = () => {
    if (!this.editor) return;

    if (this.fakeOnContainerOpenEvent) {
      this.fakeOnContainerOpenEvent = false;
      return;
    }

    this.editor.focus();

    // If we ran into a layout state from localStorage that doesn't have
    // a file ID, or the file ID is not the same, then we should sync the
    // filesystem ID with this tab state's file ID. We can only do this for
    // non-IDE versions, because the ID always uses IDs properly and can have
    // multiple filenames. It can be assumed that both the exam and iframe will
    // not have duplicate filenames.
    if (!Terra.c.IS_IDE) {
      const file = Terra.vfs.findFileWhere({ name: this.container.parent.config.title });
      const { fileId } = this.container.getState();
      if (!fileId || (file && fileId !== file.id)) {
        this.container.extendState({ fileId: file.id });
      }
    }

    // Add custom class for styling purposes.
    this.getParentComponentElement().classList.add('component-container', 'editor-component-container');

    if (!Terra.f.getActiveEditor()) {
      this.setActiveEditor();
    }

    if (Terra.c.IS_IDE) {
      this.reloadFileContent(true);
    }

    // Spawn a new worker if necessary.
    if (this.ready) {
      createLangWorkerApi(this.proglang);
    }
  }

  /**
   * Reload the file content either from VFS or LFS.
   * This only applies for the IDE.
   *
   * @param {boolen} [force] - True to force reload the file content from LFS.
   */
  reloadFileContent = (force = false) => {
    if (Terra.v.blockLFSPolling && !force) return;

    const file = Terra.vfs.findFileById(this.container.getState().fileId);
    if (file) {
      if (Terra.f.hasLFS() && Terra.lfs.loaded && typeof file.size === 'number' && file.size > Terra.c.LFS_MAX_FILE_SIZE) {
        // Disable the editor if the file is too large.
        this.editor.container.classList.add('exceeded-filesize');
        this.editor.setReadOnly(true);
        this.editor.clearSelection();
        this.editor.blur();
      } else if (Terra.f.hasLFS() && !Terra.f.hasGitFSWorker() && !file.content) {
        // Load the file content from LFS.
        const cursorPos = this.editor.getCursorPosition()
        Terra.lfs.getFileContent(file.id).then((content) => {
          // Only update the content if it has changed.
          if (this.editor && typeof content === 'string' && this.editor.getValue() !== content) {
            this.editor.setValue(content);
            this.editor.clearSelection();
            this.editor.moveCursorToPosition(cursorPos);
          }
        });
      } else if (file.content) {
        if (this.editor.getValue() !== file.content) {
          this.editor.setValue(file.content);
          this.editor.clearSelection();
        }
      }
    }
  }

  /**
   * Callback to lock the current editor.
   */
  onContainerLock = () => {
    this.editor.setReadOnly(true);
  }

  /**
   * Callback to unlock the current editor.
   */
  onContainerUnlock = () => {
    this.editor.setReadOnly(false);
  }

  /**
   * Callback to set the custom autocompleter for the editor.
   *
   * @param {array} completions - List of objects with 'name' and 'value' keys.
   */
  onContainerSetCustomAutoCompleter = (completions) => {
    this.editor.completers.push({
      getCompletions: (editor, session, pos, prefix, callback) => {
        if (prefix.length === 0) { callback(null, []); return }

        callback(null, completions);
      }
    });
  }

  /**
   * Callback when the container is resized.
   */
  onContainerResize = () => {
    this.editor.setAutoScrollEditorIntoView(true);
    this.editor.resize();
  }

  /**
   * Callback when the container is rendered for the first time.
   */
  onContainerAfterFirstRender = () => {
    this.ready = true;

    // Reset the session after the first initial page render to prevent the
    // initial content is removed when users hit ctrl+z or cmd+z.
    this.editor.getSession().getUndoManager().reset();
  }

  /**
   * Callback before the container is destroyed.
   */
  onContainerDestroy = () => {
    if (!this.editor) return;

    // If it's the last tab being closed, then we insert another 'Untitled' tab,
    // because we always need at least one tab open.
    const tabs = Terra.f.getAllEditorTabs();
    const totalTabs = tabs.length;

    if (totalTabs >= 2) {
      // Switch to the first tab.
      tabs[0].parent.setActiveContentItem(tabs[0]);
      if (tabs[0].instance.editor) {
        tabs[0].instance.editor.focus();
      }
    }
    else if (totalTabs === 1) {
      const currentTab = tabs[0];
      currentTab.parent.addChild({
        type: 'component',
        componentName: 'editor',
        componentState: {
          fontSize: Terra.c.BASE_FONT_SIZE,
        },
        title: 'Untitled',
      });
    } else {
      this.setActiveEditor(null);
    }

    this.editor.destroy();
    this.editor = null;
  }

  /**
   * Get the parent component element.
   */
  getParentComponentElement = () => {
    return this.container.parent.parent.element[0];
  }

  /**
   * Set the active editor.
   *
   * @param {*} value - The editor instance to set as active.
   */
  setActiveEditor = (value) => {
    Terra.layout._lastActiveEditor = (typeof value !== 'undefined')
      ? value
      : this.container.parent;
  }

  /**
   * Set the font size of the editor.
   *
   * @param {number} fontSize - The font size in pixels.
   */
  setFontSize = (fontSize) => {
    this.container.extendState({ fontSize });
    this.editor.setFontSize(`${fontSize}px`);
  }

  /**
   * Set the theme of the editor.
   *
   * @param {string} theme - Either 'dark' or 'light'.
   */
  setTheme = (theme) => {
    const newTheme = (theme === 'dark')
      ? 'ace/theme/cloud_editor_dark'
      : 'ace/theme/textmate'

    this.editor.setTheme(newTheme);
  }

  /**
   * Set the programming language of the editor.
   *
   * @param {string} proglang - File extension or programming language.
   */
  setProgLang = (proglang) => {
    let mode;

    switch (proglang.toLowerCase()) {
      case 'py':
        mode = 'python';
        break;

      case 'cpp':
      case 'c':
        mode = 'c_cpp';
        break;

      case 'rs':
        mode = 'rust';
        break;

      case 'bash':
        mode = 'sh';
        break;

      case 'jsx':
      case 'js':
      case 'ts':
      case 'typescript':
        mode = 'tsx';
        break;

      case 'md':
        mode = 'markdown';
        break;

      case 'untitled':
        mode = 'text';
        break;

      case 'svg':
        mode = 'html'
        break;

      case 'yml':
        mode = 'yaml'
        break;

      default:
        mode = proglang.toLowerCase();
        break;
    }

    this.proglang = proglang;
    this.editor.getSession().setMode(`ace/mode/${mode}`);
  }

  /**
   * Bind all editor events with callbacks.
   */
  bindEditorEvents = () => {
    this.editor.on('load', () => {
      this.onEditorLoad();
      if (Terra.c.IS_IDE) {
        Terra.pluginManager.triggerEvent('onEditorLoad', this);
      }
    });

    this.editor.on('change', () => {
      // GoldenLayout removes and re-inserts texts when dragging tabs, which
      // in the end didn't change any of the contents, so we should ignore
      // the change event in this case.
      if (this.isDraggingTab) return;

      this.onEditorChange();
      if (Terra.c.IS_IDE) {
        Terra.pluginManager.triggerEvent('onEditorChange', this);
      }
    });

    this.editor.on('focus', () => {
      this.onEditorFocus();
      if (Terra.c.IS_IDE) {
        Terra.pluginManager.triggerEvent('onEditorFocus', this);
      }
    });
  }

  onTabDragStart = () => {
    this.isDraggingTab = true;
  }

  onTabDragStop = () => {
    this.isDraggingTab = false;
  }

  /**
   * Bind all container events with callbacks.
   */
  bindContainerEvents = () => {
    // Do not trigger the plugin manager here, this is handeld elsewhere.
    this.container.on('afterFirstRender', this.onContainerAfterFirstRender);

    this.container.on('onTabDragStart', ({ event, tab }) => {
      this.onTabDragStart();
      if (Terra.c.IS_IDE) {
        Terra.pluginManager.triggerEvent('onTabDragStart', event, tab);
      }
    });

    this.container.on('onTabDragStop', ({ event, tab }) => {
      this.onTabDragStop();
      if (Terra.c.IS_IDE) {
        Terra.pluginManager.triggerEvent('onTabDragStop', event, tab);
      }
    });

    this.container.on('show', () => {
      this.onContainerOpen();
      if (Terra.c.IS_IDE) {
        Terra.pluginManager.triggerEvent('onEditorContainerOpen', this);
      }
    });

    this.container.on('lock', () => {
      this.onContainerLock();
      if (Terra.c.IS_IDE) {
        Terra.pluginManager.triggerEvent('onEditorContainerLock', this);
      }
    });

    this.container.on('setCustomAutocompleter', (completions) => {
      this.onContainerSetCustomAutoCompleter(completions);
      if (Terra.c.IS_IDE) {
        Terra.pluginManager.triggerEvent('onEditorContainerSetCustomAutoCompleter', completions, this);
      }
    });

    this.container.on('unlock', () => {
      this.onContainerUnlock();
      if (Terra.c.IS_IDE) {
        Terra.pluginManager.triggerEvent('onEditorContainerUnlock', this);
      }
    });

    this.container.on('themeChanged', (theme) => {
      this.setTheme(theme);
      if (Terra.c.IS_IDE) {
        Terra.pluginManager.triggerEvent('setEditorTheme', theme, this);
      }
    });

    this.container.on('fontSizeChanged', (fontSize) => {
      this.setFontSize(fontSize);
      if (Terra.c.IS_IDE) {
        Terra.pluginManager.triggerEvent('setEditorFontSize', fontSize, this);
      }
    });

    this.container.on('resize', () => {
      this.onContainerResize();
      if (Terra.c.IS_IDE) {
        Terra.pluginManager.triggerEvent('onEditorContainerResize', this);
      }
    });

    this.container.on('destroy', () => {
      this.onContainerDestroy();
      if (Terra.c.IS_IDE) {
        Terra.pluginManager.triggerEvent('onEditorContainerDestroy', this);
      }
    });

    this.container.on('reloadContent', () => {
      this.reloadFileContent();
      if (Terra.c.IS_IDE) {
        Terra.pluginManager.triggerEvent('onEditorContainerReloadContent', this);
      }
    });
  }
}
