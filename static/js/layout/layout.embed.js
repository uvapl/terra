import Terra from '../terra.js';
import Layout from './layout.js';

export default class EmbedLayout extends Layout {
  termStartupMessage = [
    'Click the "Run" button to execute code.',
  ];

  /**
   * Create the layout.
   *
   * @param {array} content - List of content objects.
   * @param {number} fontSize - The default font-size to be used.
   * @param {object} options - Additional options object.
   * @param {boolean} options.vertical - Whether the layout should be vertical.
   * @param {string} options.proglang - The programming language to be used
   */
  constructor(content, fontSize, options = {}) {
    const defaultLayoutConfig = {
      dimensions: {
        borderWidth: 0,
      },
      content: [
        {
          type: options.vertical ? 'column' : 'row',
          content: [
            {
              content,
            },
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
    const settingsMenuHtml = this.getSettingsMenuHtml();

    const $editorContainer = $('.editor-component-container');
    const $terminalContainer = $('.terminal-component-container');

    if (this.vertical) {
      // Vertical layout
      $editorContainer
        .find('.lm_controls')
        .append(runCodeButtonHtml)
        .append(settingsMenuHtml);
    } else {
      // Horizontal layout.
      $terminalContainer.find('.lm_controls')
        .append(runCodeButtonHtml)
        .append(settingsMenuHtml);
    }

    this.renderConfigButtons();
    this.addActiveStates();
    this.addButtonEventListeners();
  }


  onRunCodeButtonClick() {
    this.dispatchEvent(new CustomEvent('runCode', {
      detail: { clearTerm: true },
    }));
  }
}
