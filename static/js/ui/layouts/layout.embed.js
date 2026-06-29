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
          // Root type (column/row) is stamped by the base Layout from the
          // resolved orientation (Embed derives it from options.vertical).
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

  /**
   * Customize layout as loaded.
   */
  initCustomContent() {
    const settingsMenuHtml = this.getSettingsMenuHtml();

    // The run button is built into the static `#toolbar` by the controller's
    // buildToolbar pass. The settings dropdown stays in the GoldenLayout
    // controls: vertical layout puts them on the editor, horizontal on the
    // terminal. (The embed run command clears the terminal before each run;
    // see config.embed.js.)
    const $controls = this.vertical
      ? $('.editor-component-container').find('.lm_controls')
      : $('.terminal-component-container').find('.lm_controls');

    $controls.append(settingsMenuHtml);

    const $header = this.vertical
      ? $('.editor-component-container').find('.lm_header')
      : $('.terminal-component-container').find('.lm_header');

    $header.append(`<div class="toolbar" id="toolbar"></div>`);
  }
}
