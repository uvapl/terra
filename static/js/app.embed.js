class EmbedApp extends App {
  setupLayout = () => {
    const queryParams = Terra.f.parseQueryParams();
    if (typeof queryParams.filename !== 'string') {
      throw Error('No filename provided in query params');
    }

    const isHorizontal = queryParams.layout === 'horizontal';
    const isVertical = !isHorizontal;

    // Update local storage key.
    const currentStorageKey = Terra.f.makeLocalStorageKey(window.location.href);
    Terra.f.updateLocalStoragePrefix(currentStorageKey);

    // Create the tab in the virtual filesystem.
    Terra.vfs.createFile({ name: queryParams.filename });

    // Create tabs with the filename as key and empty string as the content.
    const tabs = {}
    tabs[queryParams.filename] = '';

    // Get the programming language based on the filename.
    const proglang = Terra.f.getFileExtension(queryParams.filename);

    // Initialise the programming language specific worker API.
    Terra.langWorkerApi = new LangWorkerAPI(proglang);

    // Get the font-size stored in local storage or use fallback value.
    const fontSize = Terra.f.getLocalStorageItem('font-size', Terra.c.BASE_FONT_SIZE);

    // Create the content objects that represent each tab in the editor.
    const content = this.generateConfigContent(tabs, fontSize);

    // Create the layout object.
    const layout = this.createLayout(content, fontSize, {
      proglang,
      vertical: isVertical,
    });

    $('body').addClass(isVertical ? 'vertical' : 'horizontal');

    // Make layout instance available at all times.
    Terra.layout = layout;

    this.postSetupLayout();
    return layout;
  }
}
