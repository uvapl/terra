import Layout from './layout.js';
import { hasLFSApi } from '../helpers/shared.js';
import LFS from '../lfs.js';
import localStorageManager from '../local-storage-manager.js';

export default class IDELayout extends Layout {
  getClearTermButtonHtml = () => '<button id="clear-term" class="button clear-term-btn">Clear terminal</button>';

  renderButtons = () => {
    const runCodeButtonHtml = this.getRunCodeButtonHtml();
    const clearTermButtonHtml = this.getClearTermButtonHtml();

    // Add run-code and clear-term to the DOM.
    const $terminalContainer = $('.terminal-component-container');
    $terminalContainer.find('.lm_header').append(runCodeButtonHtml);
    $terminalContainer.find('.lm_header > .lm_controls').prepend(clearTermButtonHtml)

    this.addButtonEventListeners();
  };

  onStateChanged = () => {
    let config = this.toConfig();

    // Exclude the content from all editors for the IDE when LFS is enabled,
    // because for LFS we use lazy loading, i.e. only load the content when
    // opening the file.
    if (hasLFSApi() && LFS.loaded) {
      config = this._removeEditorValue(config);
    }

    const state = JSON.stringify(config);
    localStorageManager.setLocalStorageItem('layout', state);
  }

  _removeEditorValue = (config) => {
    if (config.content) {
      config.content.forEach((item) => {
        if (item.type === 'component') {
          item.componentState.value = '';
        } else {
          this._removeEditorValue(item);
        }
      });
    }
    return config;
  }
}
