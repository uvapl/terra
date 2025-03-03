////////////////////////////////////////////////////////////////////////////////
// This file contains functions that are used inside all main.*.js files.
////////////////////////////////////////////////////////////////////////////////

/**
 * Create a list of content objects based on the tabs config data.
 *
 * @param {object} tabs - An object where each key is the filename and the
 * value is the default value the editor should have when the file is opened.
 * @param {number} fontSize - The default font-size used for the content.
 * @returns {array} List of content objects.
 */
function generateConfigContent(tabs, fontSize) {
  return Object.keys(tabs).map((filename) => {
    let fileId = Terra.f.uuidv4();
    const file = Terra.vfs.findFileWhere({ name: filename });
    if (file) {
      fileId = file.id;
    }

    return {
      type: 'component',
      componentName: 'editor',
      componentState: {
        fontSize: fontSize,
        value: tabs[filename],
        fileId,
      },
      title: filename,
      isClosable: false,
    }
  });
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
function createLayout(content, fontSize, options = {}) {
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
