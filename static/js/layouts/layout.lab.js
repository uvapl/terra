import Layout from './layout.js';

export default class LabLayout extends Layout {
  tabsClosable = false;

  /**
   * Create the layout: editor tabs on top, terminal below. The lab's README
   * is rendered in a fixed sidebar next to the layout container and is not
   * part of the GoldenLayout structure.
   *
   * @param {object} options - Controller-supplied options.
   * @param {array} options.files - List of filenames to open as tabs.
   * @param {number} options.fontSize - The default font-size to be used.
   */
  constructor(options = {}) {
    const { files, fontSize } = options;

    // Create the content objects that represent each tab in the editor. The
    // file contents are not embedded: each editor loads them from the VFS
    // when it is shown.
    const content = files.map((filename) => ({
      type: 'component',
      componentName: 'editor',
      componentState: {
        fontSize,
        path: filename,
      },
      title: filename,
      isClosable: false,
    }));

    // A lab without files (e.g. the minimal `lab50: true` form) still needs
    // at least one tab in the editor stack.
    if (content.length === 0) {
      content.push({
        type: 'component',
        componentName: 'editor',
        componentState: { fontSize },
        title: 'Untitled',
        isClosable: false,
      });
    }

    const defaultLayoutConfig = {
      settings: {
        showPopoutIcon: false,
        showMaximiseIcon: false,
        showCloseIcon: false,
        reorderEnabled: false,
      },
      content: [
        {
          type: 'column',
          content: [
            { content },
            {
              componentState: { fontSize },
            }
          ]
        }
      ]
    };

    super(defaultLayoutConfig, options);
  }

  renderButtons() {
    const runCodeButtonHtml = this.getRunCodeButtonHtml();
    const clearTermButtonHtml = this.getClearTermButtonHtml();
    const settingsMenuHtml = this.getSettingsMenuHtml();

    // Add run-code, clear-term and settings menu to the DOM.
    const $terminalContainer = $('.terminal-component-container');
    $terminalContainer.find('.lm_header').append(runCodeButtonHtml).append(clearTermButtonHtml);
    $terminalContainer.find('.lm_controls').append(settingsMenuHtml);

    this.addActiveStates();
    this.addButtonEventListeners();
  }

  /**
   * Render the lab name in the page title.
   *
   * @param {object} config - The lab config object.
   */
  setPageTitle(config) {
    const labName = config.name || 'Lab';
    $('.page-title').text(labName);
    document.title = `${labName} - Proglab Lab`;
  }
}
