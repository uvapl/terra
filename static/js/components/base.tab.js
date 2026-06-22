import { getPartsFromPath } from '../lib/helpers.js';

/**
 * A component for Golden Layout to host an editor or a terminal.
 * This base class contains some default plumbing.
 */
export default class BaseTab extends EventTarget {
  /**
   * The container holds the component within Golden Layout.
   * @type {GoldenLayout.ItemContainer}
   */
  container = null;

  /**
   * Initialization state.
   * @type {object}
   */
  state = null;

  constructor(container, state) {
    super();
    this.container = container;
    this.state = state;
  }

  /**
   * The container's parent is a "ComponentItem", a specific kind of
   * ContentItem in Golden Layout.
   */
  getComponentItem = () => {
    return this.container.parent;
  }

  /**
   * Get the name (type) of the component, e.g. "editor".
   *
   * @returns {string} Name of the component.
   */
  getComponentName = () => {
    return this.getComponentItem().config.componentName;
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
    return this.getComponentItem().config.title;
  }

  /**
   * Set the filename of the corresponding tab.
   *
   * @param {string} filename - The new name of the tab.
   */
  setFilename = (filename) => {
    this.getComponentItem().setTitle(filename);
  }

  // Basic tab manipulation

  /**
   * Close the current editor, which will completely destroy the editor.
   */
  close = () => {
    this.getComponentItem().parent.removeChild(this.getComponentItem());
  }

  /**
   * Activate item within its tab strip.
   */
  setActive = () => {
    this.getComponentItem().parent.setActiveContentItem(this.getComponentItem());
  }

  /**
   * Get DOM element for the containing tab strip.
   */
  getParentComponentElement = () => {
    return this.getComponentItem().parent.element[0];
  }
}
