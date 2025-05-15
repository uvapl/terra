import { getFileExtension } from '../helpers/shared.js';
import TabComponent from './tab.component.js';
import pluginManager from '../plugin-manager.js';

/**
 * Image component for GoldenLayout.
 */
export default class ImageComponent extends TabComponent {
  constructor(container, state) {
    super(container, state);

    this.init();
  }

  init = () => {
    this.container.parent.isImage = true;

    this.bindContainerEvents();
    this.initImageElement();
  }

  initImageElement = () => {
    const contentContainer = this.container.getElement()[0];
    this.img = document.createElement('img');

    if (this.state.value) {
      this.setContent(this.state.value);
    }

    contentContainer.appendChild(this.img);
  }

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
   * Set the src attribute on the image element.
   *
   * @param {string} base64String - Base64 encoded string of the image.
   */
  setContent = (base64String) => {
    if (typeof base64String === 'string') {
      this.img.src = `data:${this.getFileMimeType()};base64,` + base64String;
    }
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
    this.getParentComponentElement().classList.remove('component-container', 'image-component-container');
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
      pluginManager.triggerEvent('onImageShow', this);
    });

    this.container.on('hide', () => {
      this.onHide();
      pluginManager.triggerEvent('onImageHide', this);
    });

    this.container.on('destroy', () => {
      this.onDestroy();
      pluginManager.triggerEvent('onImageDestroy', this);
    });

    this.container.on('vfsChanged', () => {
      this.dispatchEvent(new Event('vfsChanged'));
    });
  }
}
