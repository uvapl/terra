import { getFileExtension } from '../../lib/helpers.js';
import BaseTab from './base.tab.js';

/**
 * Image component for GoldenLayout.
 */
export default class ImageTab extends BaseTab {
  constructor(container, state) {
    super(container, state);

    this.init();
  }

  init = () => {
    this.container.parent.isImage = true;
    this.container.getComponent = () => this;

    this.bindContainerEvents();
    this.initImageElement();
  }

  initImageElement = () => {
    const contentContainer = this.container.getElement()[0];
    this.img = document.createElement('img');

    contentContainer.appendChild(this.img);
  }

  /**
   * Disable the image component if the size if too large.
   */
  exceededFileSize = () => {
    this.img.parentNode.classList.add('exceeded-filesize');
  }

  /**
   * Get the MIME type of a file based on its extension.
   *
   * @returns {string} The MIME type of the file.
   */
  getFileMimeType = () => {
    const ext = getFileExtension(this.getFilename()).toLowerCase();
    const mimeTypes = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      bmp: 'image/bmp',
      webp: 'image/webp',
    };
    return mimeTypes[ext];
  }

  /**
   * Set the src attribute of the image component.
   *
   * @param {string} src - The source URL of the image.
   */
  setSrc = (src) => {
    this.img.src = src;
  }

  /**
   * Update the displayed image directly from raw file content. Used when a
   * program run modifies an already-open image: reading back through the VFS
   * would race the debounced disk write and show the previous image, so we
   * build a blob URL straight from the new bytes.
   *
   * @param {ArrayBuffer|Uint8Array} content - The raw image bytes.
   */
  setContent = (content) => {
    if (this.img.src) {
      URL.revokeObjectURL(this.img.src);
    }

    const blob = new Blob([content], { type: this.getFileMimeType() });
    this.setSrc(URL.createObjectURL(blob));
  }

  /**
   * Get the base64 encoded string of the image src attribute.
   *
   * @returns {string} Base64 encoded string.
   */
  getContent = () => {
    if (!this.img.src) return '';

    return this.img.src.split(',')[1];
  }

  /**
   * Get the current state of the editor.
   *
   * @returns {object} The state of the editor.
   */
  getState = () => {
    return this.container.getState();
  }

  /**
   * Callback function when the image component is shown/opened.
   */
  onShow = () => {
    this.dispatchEvent(new Event('show'));
    this.getParentComponentElement().classList.add('component-container', 'image-component-container');
  }

  /**
   * Callback function when the image component is hidden/closed.
   */
  onHide = () =>  {
    // Function deleted because removing the classes only causes problems.
  }

  /**
   * Callback function when the image component is destroyed.
   */
  onDestroy = () => {
    this.dispatchEvent(new Event('destroy'));
  }

  /**
   * Bind all container events with callbacks.
   */
  bindContainerEvents = () => {
    this.container.on('show', () => {
      this.onShow();
    });

    this.container.on('hide', () => {
      this.onHide();
      this.dispatchEvent(new Event('hide'));
    });

    this.container.on('destroy', () => {
      this.onDestroy();
    });

  }
}
