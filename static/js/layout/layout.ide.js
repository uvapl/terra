import Layout from './layout.js';
import { BASE_FONT_SIZE } from '../constants.js';
import {
  hasLFS,
} from '../helpers/shared.js';
import LFS from '../lfs.js';
import localStorageManager from '../local-storage-manager.js';

export default class LayoutIDE extends Layout {
  getClearTermButtonHtml = () => '<button id="clear-term" class="button clear-term-btn">Clear terminal</button>';

  createControls = () => {
    const runCodeButtonHtml = this.getRunCodeButtonHtml();
    const clearTermButtonHtml = this.getClearTermButtonHtml();

    const $terminalContainer = $('.terminal-component-container');

    $terminalContainer.find('.lm_header').append(runCodeButtonHtml);
    $terminalContainer.find('.lm_header > .lm_controls').prepend(clearTermButtonHtml)

    // Add active state to font-size dropdown.
    const $fontSizeMenu = $('#font-size-menu');
    const currentFontSize = localStorageManager.getLocalStorageItem('font-size') || BASE_FONT_SIZE;
    $fontSizeMenu.find(`li[data-val=${currentFontSize}]`).addClass('active');

    // Add active state to theme dropdown.
    const currentTheme = localStorageManager.getLocalStorageItem('theme') || 'light';
    const $editorThemeMenu = $('#editor-theme-menu');
    $editorThemeMenu.find(`li[data-val=${currentTheme}]`).addClass('active');

    // Add event listeners for setttings menu.
    $('.settings-menu').click((event) => $(event.target).toggleClass('open'));
    $(document).click((event) => {
      if (!$(event.target).is($('.settings-menu.open'))) {
        $('.settings-menu').removeClass('open');
      }
    });

    this.addControlsEventListeners();
  };

  onStateChanged = () => {
    let config = this.toConfig();

    // Exclude the content from all editors for the IDE when LFS is enabled,
    // because for LFS we use lazy loading, i.e. only load the content when
    // opening the file.
    if (hasLFS() && LFS.loaded) {
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
