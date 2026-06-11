import Layout from './layout.js';

export default class LabLayout extends Layout {
  tabsClosable = false;

  /**
   * Create the layout: editor tabs on top, terminal below. The lab's README
   * is rendered in a fixed sidebar next to the layout container and is not
   * part of the GoldenLayout structure.
   *
   * @param {array} content - List of content objects.
   * @param {number} fontSize - The default font-size to be used.
   * @param {object} options - Additional options object.
   * @param {string} options.proglang - The programming language to be used.
   */
  constructor(content, fontSize, options = {}) {
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
