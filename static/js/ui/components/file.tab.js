import { getPartsFromPath } from '../../lib/helpers.js';
import BaseTab from './base.tab.js';

/**
 * A tab backed by a file on disk, holding a path and a filename. Superclass for
 * the editor and image tabs; tabs without a file (canvas, terminal) extend
 * BaseTab directly.
 */
export default class FileTab extends BaseTab {
  /**
   * Get tab's corresponding filepath.
   *
   * @returns {string} The path of the tab.
   */
  getPath = () => {
    return this.container.getState().path;
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
    this.container.extendState({ path });
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
}
