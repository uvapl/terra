class LayoutIDE extends Layout {
  constructor(defaultLayoutConfig, options = {}) {
    super(defaultLayoutConfig, options);
  }

  createControls = () => {
    const runCodeButtonHtml = this.getRunCodeButtonHtml();
    const clearTermButtonHtml = this.getClearTermButtonHtml();

    const $terminalContainer = $('.terminal-component-container');

    $terminalContainer.find('.lm_header').append(runCodeButtonHtml).append(clearTermButtonHtml)

    // Add active state to font-size dropdown.
    const $fontSizeMenu = $('#font-size-menu');
    const currentFontSize = getLocalStorageItem('font-size') || BASE_FONT_SIZE;
    $fontSizeMenu.find(`li[data-val=${currentFontSize}]`).addClass('active');

    // Add active state to theme dropdown.
    const currentTheme = getLocalStorageItem('theme') || 'light';
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
  }
}
