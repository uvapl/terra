import Layout from './layout.js';

export default class ExamLayout extends Layout {
  renderButtons() {
    const runCodeButtonHtml = this.getRunCodeButtonHtml();
    const clearTermButtonHtml = this.getClearTermButtonHtml();
    const settingsMenuHtml = this.getSettingsMenuHtml();

    // Add run-code, clear-term and settings menu to the DOM.
    const $terminalContainer = $('.terminal-component-container');
    $terminalContainer.find('.lm_header').append(runCodeButtonHtml).append(clearTermButtonHtml);
    $terminalContainer.find('.lm_controls').append(settingsMenuHtml);

    this.renderConfigButtons();
    this.addActiveStates();
    this.addButtonEventListeners();
  }
}
