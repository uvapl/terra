import Layout from './layout.js';

export default class EmbedLayout extends Layout {
  termStartupMessage = [
    'Click the "Run" button to execute code.',
  ];

  /**
   * Create the layout.
   *
   * @param {object} options - Controller-supplied options.
   * @param {object} options.tabs - Map of filename to content for each tab.
   * @param {number} options.fontSize - The default font-size to be used.
   * @param {boolean} options.vertical - Whether the layout should be vertical.
   */
  constructor(options = {}) {
    const { tabs, fontSize } = options;

    // Create the config for each tab.
    const content = Object.keys(tabs).map((filename) => ({
      type: 'component',
      componentName: 'editor',
      componentState: {
        fontSize,
        value: tabs[filename],
        path: filename,
      },
      title: filename,
      isClosable: false,
    }));

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
    this.delegate?.onRunCode?.({ clearTerm: true });
  }
}
