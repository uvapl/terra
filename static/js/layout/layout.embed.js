import Terra from '../terra.js';
import Layout from './layout.js';

export default class EmbedLayout extends Layout {
  termStartupMessage = [
    'Click the "Run" button to execute code.',
  ];

  renderButtons = () => {
    const runCodeButtonHtml = this.getRunCodeButtonHtml();
    const settingsMenuHtml = this.getSettingsMenuHtml();

    const $editorContainer = $('.editor-component-container');
    const $terminalContainer = $('.terminal-component-container');

    if (this.vertical) {
      // Vertical layout
      $editorContainer
        .find('.lm_controls')
        .append(runCodeButtonHtml)
        .append(settingsMenuHtml);
    } else {
      // Horizontal layout.
      $terminalContainer.find('.lm_controls')
        .append(runCodeButtonHtml)
        .append(settingsMenuHtml);
    }

    this.renderConfigButtons();
    this.addActiveStates();
    this.addButtonEventListeners();
  }


  onRunCodeButtonClick = () => {
    Terra.app.runCode(null, true);
  }
}
