/**
 * Base class that is extended for each of the apps.
 */
class App {

  /**
   * Reference to the GoldenLayout instance.
   * @type {GoldenLayout.Layout}
   */
  layout = null;

  init = async () => {
    // Await the setupLayout because some apps might need to do async work.
    await this.setupLayout();

    // We register the postSetupLayout as a callback, which will be called when
    // the subsequent init() function has finished.
    this.layout.on('initialised', () => this._call('postSetupLayout'));

    this.layout.init();
  }

  setupLayout = () => {
    console.info('setupLayout() not implemented');
  }

  /**
   *  Given a function name, call its private function (prefixed with an
   *  underscore) if it exists, as well as its public function which is only
   *  implemented in child classes that extend the App class. This logic is
   *  added to prevent rebinding `this` for every function that is needed as
   *  well as calling `super.fn()` in child classes. Moreover, there's quite
   *  some functions that we *always* want to execute, but allow child classes
   *  to *extend* the logic and not overwrite it.
   *
   * @param {string} fn - The function name to execute
   * @param {array} args - A list of arguments to pass to the function
   */
  _call(fn, args) {
    if (!Array.isArray(args)) {
      args = [args];
    }

    const privateFn = `_${fn}`;
    if (typeof this[privateFn] === 'function') {
      this[privateFn].apply(this, args);
    }

    if (typeof this[fn] === 'function') {
      this[fn].apply(this, args);
    }
  }

  /**
   * Called after the layout has been setup to do some post setup work.
   */
  _postSetupLayout = () => {
    this.layout.on('tabCreated', (tab) => {
      const editorComponent = tab.contentItem.instance;
      const { editor } = editorComponent;
      if (editor) {
        editor.on('change', () => this._call('onEditorChange', [editorComponent]));
      }
    });
  }

  /**
   * Callback functions that is called when any editor its content changes.
   */
  _onEditorChange = (editorComponent) => {
    const { fileId } = editorComponent.container.getState();
    if (fileId) {
      Terra.vfs.updateFile(fileId, {
        content: editorComponent.editor.getValue(),
      });
    }
  }

  /**
   * Create a list of content objects based on the tabs config data.
   *
   * @param {object} tabs - An object where each key is the filename and the
   * value is the default value the editor should have when the file is opened.
   * @param {number} fontSize - The default font-size used for the content.
   * @returns {array} List of content objects.
   */
  generateConfigContent = (tabs, fontSize) => {
    return Object.keys(tabs).map((filename) => ({
      type: 'component',
      componentName: 'editor',
      componentState: {
        fontSize: fontSize,
        value: tabs[filename],
        fileId: Terra.f.uuidv4(),
      },
      title: filename,
      isClosable: false,
    }));
  }

  /**
   * Create the layout object with the given content objects and font-size.
   *
   * @param {array} content - List of content objects.
   * @param {number} fontSize - The default font-size to be used.
   * @param {object} options - Additional options object.
   * @param {boolean} options.vertical - Whether the layout should be vertical.
   * @param {string} options.proglang - The programming language to be used
   * @param {object} options.buttonConfig - Object containing buttons with their
   * commands that will be rendered by the layout.
   * @returns {Layout} The layout instance.
   */
  createLayout = (content, fontSize, options = {}) => {
    const defaultLayoutConfig = {
      settings: {
        showPopoutIcon: false,
        showMaximiseIcon: false,
        showCloseIcon: false,
        reorderEnabled: false,
      },
      dimensions: {
        headerHeight: 30,
        borderWidth: Terra.c.IS_FRAME ? 0 : 10,
      },
      content: [
        {
          type: options.vertical ? 'column' : 'row',
          isClosable: false,
          content: [
            {
              type: 'stack',
              isClosable: false,
              content: content,
            },
            {
              type: 'component',
              componentName: 'terminal',
              componentState: { fontSize: fontSize },
              isClosable: false,
            }
          ]
        }
      ]
    };

    return new Layout(defaultLayoutConfig, options);
  }
}
