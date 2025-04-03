import { BASE_FONT_SIZE } from '../constants.js';
import { hideTermCursor } from '../helpers/term-component.js';
import Terra from '../terra.js';

/**
 * Terminal component for GoldenLayout.
 */
export default class TerminalComponent {
  /**
   * An addon for xterm.js that enables fitting the terminal's dimensions to a
   * containing element. This addon requires xterm.js v4+.
   * @see https://github.com/xtermjs/xterm.js/blob/a260f7d2889142d6566a66cb9856a07050dea611/addons/addon-fit/README.md
   *
   * @type {FitAddon}
   */
  fitAddon = new FitAddon.FitAddon();

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

  constructor(container, state) {
    this.container = container;
    this.state = state;

    this.init();
  }

  init = () => {
    this.container.parent.isTerminal = true;
    this.bindContainerEvents();
  }

  /**
   * Callback when the editor is opened for the first time or it is already open
   * and becomes active (i.e. the user clicks on the tab in the UI).
   */
  onShow = () => {
    // Add custom class for styling purposes.
    this.getParentComponentElement().classList.add('component-container', 'terminal-component-container');

    const fontSize = this.state.fontSize || BASE_FONT_SIZE;

    Terra.app.layout.term = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorBlink: true,
      fontSize,
      lineHeight: 1.2
    });
    Terra.app.layout.term.loadAddon(this.fitAddon);
    Terra.app.layout.term.open(this.container.getElement()[0]);
    this.fitAddon.fit();

    // Trigger a single resize after the terminal has rendered to make sure it
    // fits the whole parent width and doesn't leave any gaps near the edges.
    setTimeout(() => {
      $(window).trigger('resize');
    }, 0);


    this.setFontSize(fontSize);
    hideTermCursor();
  }

  /**
   * Callback to set the editor into a vertical layout.
   */
  onVerticalLayout = () => {
    this.container.tab.header.position(false);
  }

  /**
   * Callback when the container is destroyed.
   */
  onContainerDestroy = () => {
    if (Terra.app.layout.term && typeof Terra.app.layout.term.destroy === 'function') {
      Terra.app.layout.term.destroy();
    }

    Terra.app.layout.term = null;
  }

  /**
   * Callback when the container is resized.
   */
  onContainerResize = () => {
    this.fitAddon.fit();
  }

  /**
   * Set the font size of the editor.
   *
   * @param {number} fontSize - The font size in pixels.
   */
  setFontSize = (fontSize) => {
    this.container.extendState({ fontSize });
    Terra.app.layout.term.options.fontSize = fontSize;
    this.fitAddon.fit();
  };

  /**
   * Get the parent component element.
   */
  getParentComponentElement = () => {
    return this.container.parent.parent.element[0];
  }

  /**
   * Bind all container events with callbacks.
   */
  bindContainerEvents = () => {
    this.container.on('open', this.onShow);
    this.container.on('verticalLayout', this.onVerticalLayout);
    this.container.on('fontSizeChanged', this.setFontSize);
    this.container.on('resize', this.onContainerResize);
    this.container.on('destroy', this.onContainerDestroy);
  }
}
