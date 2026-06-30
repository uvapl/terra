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

  constructor(container) {
    super();
    this.container = container;

    // Let GoldenLayout hand back this component instance from its container
    // (e.g. when a stack reports its active item changed).
    this.container.getComponent = () => this;
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
