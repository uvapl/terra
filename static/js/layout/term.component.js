/**
 * Global variable with reference to the term. There can only be one terminal
 * inside the UI, which is needed in other files, therefore we need a reference
 * availble to all files.
 *
 * @type {Terminal}
 */
let term;

/**
 * Terminal component for GoldenLayout.
 */
class TerminalComponent {
  fitAddon = new FitAddon.FitAddon();
  container = null;
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
   * Callback for the container open event.
   */
  onContainerOpen = () => {
    // Add custom class for styling purposes.
    this.getParentComponentElement().classList.add('component-container', 'terminal-component-container');

    const fontSize = this.state.fontSize || Terra.c.BASE_FONT_SIZE;

    term = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorBlink: true,
      fontSize,
      lineHeight: 1.2
    })
    term.loadAddon(this.fitAddon);
    term.open(this.container.getElement()[0]);
    this.fitAddon.fit();

    // Trigger a single resize after the terminal has rendered to make sure it
    // fits the whole parent width and doesn't leave any gaps near the edges.
    setTimeout(() => {
      $(window).trigger('resize');
    }, 0);


    this.setFontSize(fontSize);
    Terra.f.hideTermCursor();
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
    if (term && typeof term.destroy === 'function') {
      term.destroy();
    }

    term = null;
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
    term.options.fontSize = fontSize;
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
    this.container.on('open', this.onContainerOpen);
    this.container.on('verticalLayout', this.onVerticalLayout);
    this.container.on('fontSizeChanged', this.setFontSize);
    this.container.on('resize', this.onContainerResize);
    this.container.on('destroy', this.onContainerDestroy);
  }
}
