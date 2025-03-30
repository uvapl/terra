import {
  makeHtmlAttrs,
  makeLocalStorageKey,
} from './helpers/shared.js';
import Terra from './terra.js';
import localStorageManager from './local-storage-manager.js';

// Base plugin class that all plugins should extend.
export class TerraPlugin {
  /**
   * Unique name of the plugin without spaces, required.
   * The name will be used to identify the plugin in the plugin manager.
   * Example: 'foo' can then be referenced as `pluginManager.plugins.foo`.
   * @type {string}
   */
  name = null;

  /**
   * Array of strings containing the path to the CSS file(s) to load.
   *
   * @example ['static/plugins/check50/check50.css']
   *
   * @type {array[string]}
   */
  css = null;

  /**
   * Specifies the default state that will be peristed in local storage.
   * Only when the value contains an object type, the state is automatically
   * persisted in local storage after refresh. Set to null to not use local
   * storage persistance explicitly.
   * @type {null|object}
   */
  defaultState = null;

  /**
   * Contains the loaded local storage state that is persisted after refresh.
   * @type {object}
   */
  state = this.loadFromLocalStorage();

  /**
   * Create a button that is placed on top of the terminal component on the
   * left side.
   *
   * @param {object} buttonConfig - Button configuration object.
   * @throws {Error} - When the button configuration is missing required properties.
   * @returns {jQuery.Element} jQuery object reference to the newly created button.
   */
  createTermButtonLeft(buttonConfig) {
    const buttonHtml = this.createTermButtonHtml(buttonConfig);
    $('.terminal-component-container .lm_header').append(buttonHtml);

    const $button = $(`#${buttonConfig.id}`);
    $button.click(buttonConfig.onClick);

    return $button;
  }

  /**
   * Create a button that is placed on top of the terminal component on the
   * right side.
   *
   * @param {object} buttonConfig - Button configuration object.
   * @throws {Error} - When the button configuration is missing required properties.
   * @returns {jQuery.Element} jQuery object reference to the newly created button.
   */
  createTermButtonRight(buttonConfig) {
    const buttonHtml = this.createTermButtonHtml(buttonConfig);
    $('.terminal-component-container .lm_header > .lm_controls').prepend(buttonHtml);

    const $button = $(`#${buttonConfig.id}`);
    $button.click(buttonConfig.onClick);

    return $button;
  }

  /**
   * Create the button HTML that is placed on top of the terminal component.
   *
   * @param {object} buttonConfig - Button configuration object.
   * @throws {Error} - When the button configuration is missing required properties.
   * @returns {jQuery.Element} jQuery object reference to the newly created button.
   */
  createTermButtonHtml(buttonConfig) {
    if (!buttonConfig.text || !buttonConfig.id || !buttonConfig.onClick) {
      throw new Error("Button configuration must at least contain text, id, and onClick properties.", buttonConfig);
    }

    const attrs = {};
    attrs.class = ['button'].concat(buttonConfig.class || []).join(' ');
    attrs.id = buttonConfig.id;

    if (buttonConfig.disabled) {
      attrs.disabled = 'disabled';
    }

    return `<button ${makeHtmlAttrs(attrs)}>${buttonConfig.text}</button>`;
  }

  /**
   * Load the state from local storage
   *
   * @returns {object|null} The state object from local storage or the default state.
   */
  loadFromLocalStorage() {
    const className = this.constructor.name;
    const storageKey = makeLocalStorageKey(className);
    const state = localStorageManager.getLocalStorageItem(storageKey, this.defaultState);

    if (state) {
      return JSON.parse(state);
    }

    return {};
  }

  /**
   * Get the state value by key.
   *
   * @param {string} key - The key of the state value.
   * @returns {*} The value of the state.
   */
  getState(key) {
    if (this.state.hasOwnProperty(key)) {
      return this.state[key];
    }

    return this.defaultState[key];
  }

  /**
   * Set the state value by name and automatically save it in local storage.
   *
   * @param {string} key - The key of the state value.
   * @param {string} value - The value to assign under the specified name.
   */
  setState(key, value) {
    this.state[key] = value;
    this.saveState();
  }

  /**
   * Clear the current state.
   *
   * @param {string|array} [keys] - The name of the state to clear. If not specified, the
   * entire state will be cleared.
   */
  clearState(keys) {
    if (!Array.isArray(keys)) {
      keys = [keys];
    }

    if (keys.length > 0) {
      for (const key of keys) {
        this.state[key] = structuredClone(this.defaultState[key]);
      }
    } else {
      this.state = structuredClone(this.defaultState);
    }

    this.saveState();
  }

  /**
   * Save the current state in local storage.
   */
  saveState() {
    const className = this.constructor.name;
    const storageKey = makeLocalStorageKey(className);
    localStorageManager.setLocalStorageItem(storageKey, JSON.stringify(this.state));
  }

  // EVENT LISTENERS THAT CAN BE IMPLEMENTED FOR EACH PLUGIN.
  // ========================================================
  // onLayoutLoaded = () => { }
  // onEditorContainerLoaded = (editorComponent) => { }
  // onEditorContainerChange = (editorComponent) => { }
  // onEditorFocus = (editorComponent) => { }
  // onEditorContainerOpen = (editorComponent) => { }
  // onEditorContainerLock = (editorComponent) => { }
  // onEditorContainerSetCustomAutoCompleter = (completions, editorComponent) => { }
  // onEditorContainerUnlock = (editorComponent) => { }
  // setEditoContainerTheme = (theme, editorComponent) => { }
  // setEditoContainerFontSize = (fontSize, editorComponent) => { }
  // onEditorContainerResize = (editorComponent) => { }
  // onEditorContainerDestroy = (editorComponent) => { }
  // onEditorContainerReloadContent = (editorComponent) => { }
  // onStorageChange = (storageName, prevStorageName) => { }
  // onPluginRegistered = (plugin) => { }
}

class TerraPluginManager {
  /**
   * Contains a reference to all loaded plugins.
   * @type {object}
   */
  plugins;

  constructor() {
    this.plugins = {};
  }


  /**
   * Register a plugin.
   *
   * @param {object} plugin - A valid plugin object.
   */
  register = (plugin) => {
    if (plugin instanceof TerraPlugin) {
      this.plugins[plugin.name] = plugin;
    } else {
      throw new Error("Plugin must be an instance of the TerraPlugin class.");
    }

    if (Array.isArray(plugin.css)) {
      this.loadCSS(plugin.css);
    }

    this.triggerEvent('onPluginRegistered', plugin);
  }

  /**
   * Load a given CSS path.
   *
   * @param {string} path - The CSS path to load.
   */
  loadCSS = (path) => {
    for (const cssPath of path) {
      $('head').append(`<link rel="stylesheet" type="text/css" href="${cssPath}">`);
    }
  }

  /**
   * Load a single plugin by name residing in the `static/plugins` directory.
   *
   * @param {string} pluginName - The name of the plugin to load.
   * @returns {Promise} Resolves when the plugin is loaded.
   */
  loadPlugin = (pluginName) => {
    return new Promise((resolve, reject) => {
      import(`../plugins/${pluginName}/${pluginName}.js`)
        .then((mod) => {
          const plugin = new mod.default();
          this.register(plugin);
          resolve();
        })
        .catch(reject);
    })
  }

  /**
   * Load multiple plugins names residing in the `static/plugins` directory.
   *
   * @param {array} pluginNames - List names of the plugins to load.
   * @returns {Promise} Resolves when all plugins are loaded.
   */
  loadPlugins = (pluginNames) => {
    return Promise.all(pluginNames.map((pluginName) => this.loadPlugin(pluginName)));
  }

  /**
   * Custom behavior for the storage change event. This is necessary because
   * we need to keep track automatically of the current storage name and
   * previous storage name that are required as arguments for the event.
   *
   * @param {string} pluginName - The name of the plugin to trigger the event for.
   * @param {string} storageName - The new storage name.
   */
  triggerStorageChange = (pluginName, storageName) => {
    Terra.v.prevStorageName = Terra.v.storageName;
    Terra.v.storageName = storageName;
    this.plugins[pluginName]['onStorageChange'](
      Terra.v.storageName,
      Terra.v.prevStorageName
    );
  }

  /**
   * Trigger an event on all loaded plugins.
   *
   * @param {string} eventName - The name of the event.
   * @param {array} ...args - The arguments to pass to the event handler.
   */
  triggerEvent = (eventName, ...args) => {
    Object.keys(this.plugins).forEach((pluginName) => {
      if (typeof this.plugins[pluginName][eventName] === 'function') {
        if (eventName === 'onStorageChange') {
          this.triggerStorageChange(pluginName, ...args);
        } else {
          this.plugins[pluginName][eventName](...args);
        }
      }
    });
  }


  /**
   * Get a plugin by name.
   *
   * @param {string} name - The name of the plugin to retrieve.
   * @throws {Error} - When the plugin does not exist.
   */
  getPlugin = (name) => {
    if (!this.plugins.hasOwnProperty(name)) {
      throw new Error(`Plugin with name "${name}" does not exist.`);
    }

    return this.plugins[name];
  }
}

export default new TerraPluginManager();
