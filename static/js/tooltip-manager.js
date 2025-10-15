import { isObject } from './helpers/shared.js';

/**
 * Object that holds all tooltips.
 * @type {object<string, tippy.Instance>}
 */
const tooltips = {};

/**
 * Create a new tooltip in the DOM related to a specific anchor element.
 *
 * @param {string} key - A unique identifier for the tooltip.
 * @param {HTMLElement} anchor - The element that the tooltip will be anchored to.
 * @param {string} content - The content of the tooltip.
 * @param {object} [options] - Additional Tippy options for the tooltip.
 */
export function createTooltip(key, anchor, content, options = {}) {
  // Destroy previous tooltip in the DOM, if it exists.
  destroyTooltip(key);

  tooltips[key] = tippy(anchor, {
    content,
    animation: false,
    showOnCreate: true,
    placement: 'top',
    ...options,
  });
}

export function destroyTooltip(key) {
  if (isObject(tooltips[key])) {
    tooltips[key].destroy();
    delete tooltips[key];
  }
}

