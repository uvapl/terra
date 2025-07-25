import { BASE_FONT_SIZE } from '../constants.js';
import { getPartsFromPath } from '../helpers/shared.js';

export default class TabComponent extends EventTarget {
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

  /**
   * Whether the onContainerOpen event has been triggered falsely.
   * This happens when there is a single empty Untitled tab where the user
   * clicks on the left-sidebar to open another file. At this moment, the
   * Untitled tab will be closed, however, GoldenLayout switches to the Untitled
   * tab, closes it and then switches back to the newly inserted tab, which
   * triggers another 'show' event, which leads to code being run twice and thus
   * leading in an unexpected onfilechange event triggered, while the only thing
   * that the user did was open file.
   */
  fakeOnContainerOpenEvent = false;
  fakeOnEditorFocusEvent = false;

  constructor(container, state) {
    super();
    this.container = container;
    this.state = state;
  }

  /**
   * Get the name of the component.
   *
   * @returns {string} Name of the component.
   */
  getComponentName = () => {
    return this.container.parent.config.componentName;
  }

  /**
   * Get the state object from the component.
   *
   * @returns {object} The container state.
   */
  getState = () => {
    return this.container.getState();
  }

  /**
   * Get tab's corresponding filepath.
   *
   * @returns {string} The path of the tab.
   */
  getPath = () => {
    return this.getState().path;
  }

  /**
   * Set the path of the tab. This also updates the tab's filename.
   *
   * @param {string} path - The absolute file path of the tab.
   */
  setPath = (path) => {
    // Update the tab's filename.
    const newFilename = getPartsFromPath(path).name;
    this.setFilename(newFilename);

    // Update the state with the new path.
    this.extendState({ path });
  }

  /**
   * Extend the curent state of the editor.
   *
   * @param {object} state - Additional values to overwrite or set.
   */
  extendState = (state) => {
    this.container.extendState(state);
  }

  /**
   * Get the filename of the corresponding tab.
   *
   * @returns {string} The name of the tab.
   */
  getFilename = () => {
    return this.container.parent.config.title;
  }

  /**
   * Set the filename of the corresponding tab.
   *
   * @param {string} filename - The new name of the tab.
   */
  setFilename = (filename) => {
    this.container.parent.setTitle(filename);
  }

  /**
   * Close the current editor, which will completely destroy the editor.
   */
  close = () => {
    this.container.close();
  }

  /**
   * Add a new Untitled sibling tab next to the current editor.
   *
   * @param {GoldenLayout.ContentItem} config - Content item config object.
   */
  addSiblingTab = (config = {}) => {
    this.container.parent.parent.addChild({
      type: 'component',
      componentName: 'editor',
      title: 'Untitled',
      componentState: {
        fontSize: BASE_FONT_SIZE,
        ...config.componentState
      },
      ...config,
    });
  }

  setActive = () => {
    this.container.parent.parent.setActiveContentItem(this.container.parent);
  }

  /**
   * Get the parent component element.
   */
  getParentComponentElement = () => {
    return this.container.parent.parent.element[0];
  }
}
