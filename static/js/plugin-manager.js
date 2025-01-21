// Base plugin class that all plugins should extend.
class TerraPlugin {
  /**
   * Array of strings containing the path to the CSS file(s) to load.
   * @type {array[string]}
   */
  css;

  onLayoutLoaded() { }
  onEditorContainerLoaded(editorComponent) { }
  onEditorContainerChange(editorComponent) { }
  onEditorFocus(editorComponent) { }
  onEditorContainerOpen(editorComponent) { }
  onEditorContainerLock(editorComponent) { }
  onEditorContainerSetCustomAutoCompleter(completions, editorComponent) { }
  onEditorContainerUnlock(editorComponent) { }
  setEditoContainerTheme(theme, editorComponent) { }
  setEditoContainerFontSize(fontSize, editorComponent) { }
  onEditorContainerResize(editorComponent) { }
  onEditorContainerDestroy(editorComponent) { }
  onEditorContainerReloadContent(editorComponent) { }
}

class TerraPluginManager {
  /**
   * Contains a reference to all loaded plugins.
   * @type {object}
   */
  plugins;

  constructor() {
    this.plugins = [];
  }

  /**
   * Register a plugin.
   *
   * @param {object} plugin - A valid plugin object.
   */
  register(plugin) {
    if (plugin instanceof TerraPlugin) {
      this.plugins.push(plugin);
    } else {
      throw new Error("Plugin must be an instance of the TerraPlugin class.");
    }

    if (plugin.css) {
      this.loadCSS(plugin.css)
    }
  }

  /**
   * Load a given CSS path.
   *
   * @param {string} path - The CSS path to load.
   */
  loadCSS(path) {
    for (const cssPath of path) {
      $('head').append(`<link rel="stylesheet" type="text/css" href="${cssPath}">`);
    }
  }

  /**
   * Trigger an event on all loaded plugins.
   *
   * @param {string} eventName - The name of the event.
   * @param {array} ...args - The arguments to pass to the event handler.
   */
  triggerEvent(eventName, ...args) {
    this.plugins.forEach(plugin => {
      if (typeof plugin[eventName] === 'function') {
        plugin[eventName](...args);
      }
    });
  }
}

Terra.pluginManager = new TerraPluginManager();
