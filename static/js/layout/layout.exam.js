import Layout from './layout.js';

export default class ExamLayout extends Layout {
  /**
   * Create the layout.
   *
   * @param {array} content - List of content objects.
   * @param {number} fontSize - The default font-size to be used.
   * @param {object} options - Additional options object.
   * @param {string} options.proglang - The programming language to be used.
   * @param {object} options.buttonConfig - Object containing buttons with their
   * commands that will be rendered by the layout.
   */
  constructor(content, fontSize, options = {}) {
    const defaultLayoutConfig = {
      content: [
        {
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

    this.renderConfigButtons();
    this.addActiveStates();
    this.addButtonEventListeners();
  }
}
