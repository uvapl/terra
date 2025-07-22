import { isObject } from './helpers/shared.js';

/**
 * Wrapper class that manages tooltips using the tippy.js library.
 */
class TooltipManager {
  /**
   * Object that holds all tooltips.
   * @type {object<string, tippy.Instance>}
   */
  tooltips = {};

  /**
   * Create a new tooltip in the DOM related to a specific anchor element.
   *
   * @param {string} key - A unique identifier for the tooltip.
   * @param {HTMLElement} anchor - The element that the tooltip will be anchored to.
   * @param {string} content - The content of the tooltip.
  * @param {object} [options] - Additional Tippy options for the tooltip.
   */
  createTooltip(key, anchor, content, options = {}) {
    // Destroy previous tooltip in the DOM, if it exists.
    this.destroyTooltip(key);

    this.tooltips[key] = tippy(anchor, {
      content,
      animation: false,
      showOnCreate: true,
      placement: 'top',
      ...options,
    });
  }

  destroyTooltip(key) {
    if (isObject(this.tooltips[key])) {
      this.tooltips[key].destroy();
      delete this.tooltips[key];
    }
  }
}

export default new TooltipManager();
