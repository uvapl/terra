import { getPartsFromPath } from "../../lib/helpers.js";
import BaseTab from "./base.tab.js";

/**
 * A tab connected to a file on disk, having a path and a filename. Editor and
 * image tabs extend this class. Tabs without a file (Canvas, Terminal) extend
 * BaseTab directly.
 */
export default class FileTab extends BaseTab {
  /**
   * Get the tab's file path.
   *
   * @returns {string} path
   */
  getPath = () => {
    return this.container.getState().path;
  };

  /**
   * Set the path of the tab and update the tab's filename.
   * Might be called when a file is moved in the FS, for example.
   *
   * @param {string} path - The absolute file path of the tab.
   */
  setPath = (path) => {
    // Update the tab's filename.
    const newFilename = getPartsFromPath(path).name;
    this.setFilename(newFilename);

    // Update the state with the new path.
    this.container.extendState({ path });
  };

  /**
   * Get the tab's filename.
   *
   * @returns {string} filename
   */
  getFilename = () => {
    return this.container.title;
  };

  /**
   * Set the tab's filename.
   *
   * @param {string} filename - new name
   */
  setFilename = (filename) => {
    this.container.setTitle(filename);
  };
}
