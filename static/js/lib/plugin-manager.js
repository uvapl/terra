import {
  makeHtmlAttrs,
  slugify,
  isObject,
} from './helpers.js';
import Terra from '../terra.js';
import {
  setLocalStorageItem,
  getLocalStorageItem,
} from './local-storage-manager.js';

/**
 * Contains a reference to all loaded plugins.
 * @type {object}
 */
const plugins = {};

let storageName = null;
let prevStorageName = null;

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
  _state = null;

  /**
   * Lazy loading of the state to avoid unnecessary local storage reads and to
   * make sure the "name" property is set before loading the state.
   *
   * @returns {object} The local storage state object.
   */
  get state() {
    if (this._state === null) {
      this._state = this.loadFromLocalStorage();
    }

    return this._state;
  }

  /**
   * Get the name of the storage key that is used to store the plugin state
   *
   * @returns {string} The storage key.
   */
  get storageKey() {
    return `plugin-${this.name}`;
  }

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
    // The toolbar lives in the page chrome and survives a layout reset, but
    // onLayoutLoaded re-fires on every init. Remove any existing button with
    // this id first so a reset replaces it instead of appending a duplicate.
    // Left/right ordering is handled by CSS `order`.
    $(`#${buttonConfig.id}`).remove();
    $('#toolbar').append(buttonHtml);

    const $button = $(`#${buttonConfig.id}`);
    $button.click(buttonConfig.onClick);

    this._registerButtonAvailability(buttonConfig);

    return $button;
  }

  /**
   * If the button declares an `isAvailable` predicate, register it with the
   * command registry so its enabled state is pulled by the same invalidate()
   * pass as the run/config buttons — the plugin does not push enable/disable
   * itself. The button's click is already wired above; only its availability is
   * registered here.
   *
   * @param {object} buttonConfig
   */
  _registerButtonAvailability(buttonConfig) {
    if (!buttonConfig.isAvailable) return;

    Terra.app.commands.register([{
      name: `plugin-${buttonConfig.id}`,
      button: { id: buttonConfig.id },
      isAvailable: buttonConfig.isAvailable,
    }]);
    Terra.app.view.invalidateActions();
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
    // Position within the toolbar is handled by CSS `order`, so a plain append
    // keeps the markup simple. The toolbar survives a layout reset while
    // onLayoutLoaded re-fires, so drop any existing button with this id first to
    // replace it rather than append a duplicate.
    $(`#${buttonConfig.id}`).remove();
    $('#toolbar').append(buttonHtml);

    const $button = $(`#${buttonConfig.id}`);
    $button.click(buttonConfig.onClick);

    this._registerButtonAvailability(buttonConfig);

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
    const storageKey = slugify(this.storageKey);
    const defaultValue = isObject(this.defaultState) ? JSON.stringify(this.defaultState) : null;
    const state = getLocalStorageItem(storageKey, defaultValue);

    if (state) {
      return JSON.parse(state);
    }

    return {};
  }

  /**
   * Get the state value by key.
   *
   * @param {string} [key] - The key of the state value. If none is provided, the
   * complete state will be returned.
   * @returns {*} The value of the state.
   */
  getState(key) {
    if (!key) return this.state;

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
    const storageKey = slugify(this.storageKey);
    setLocalStorageItem(storageKey, JSON.stringify(this.state));
  }

  // EVENT LISTENERS THAT CAN BE IMPLEMENTED FOR EACH PLUGIN.
  // ========================================================
  // onLayoutLoaded = () => { }
  // onEditorTextChanged = (editorComponent) => { }
  // onEditorFocus = (editorComponent) => { }
  // onSwitchToEditorTab = (editorComponent) => { }
  // onEditorHide = (editorComponent) => { }
  // onEditorLoad = (editorComponent) => { }
  // onEditorLock = (editorComponent) => { }
  // onEditorUnlock = (editorComponent) => { }
  // onEditorContainerResize = (editorComponent) => { }
  // onEditorDestroy = (editorComponent) => { }
  // onEditorContentChanged (editorComponent) => { }
  // onSwitchToImageTab = (imageComponent) => { }
  // onImageHide = (imageComponent) => { }
  // onImageDestroy = (imageComponent) => { }
  // onImageHide = (imageComponent) => { }
  // onStorageChange = (storageName, prevStorageName) => { }
  // onPluginRegistered = (plugin) => { }
}

/**
 * Register a plugin.
 *
 * @param {object} plugin - A valid plugin object.
 */
function register(plugin) {
  if (plugin instanceof TerraPlugin) {
    plugins[plugin.name] = plugin;
  } else {
    throw new Error("Plugin must be an instance of the TerraPlugin class.");
  }

  if (Array.isArray(plugin.css)) {
    loadCSS(plugin.css);
  }

  triggerPluginEvent('onPluginRegistered', plugin);
}

/**
 * Load a given CSS path.
 *
 * @param {string} path - The CSS path to load.
 */
function loadCSS(path) {
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
function loadPlugin(pluginName) {
  return new Promise((resolve, reject) => {
    import(`../../plugins/${pluginName}/${pluginName}.js`)
      .then((mod) => {
        const plugin = new mod.default();
        register(plugin);
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
export function loadPlugins(pluginNames) {
  return Promise.all(pluginNames.map((pluginName) => loadPlugin(pluginName)));
}

/**
 * Custom behavior for the storage change event. This is necessary because
 * we need to keep track automatically of the current storage name and
 * previous storage name that are required as arguments for the event.
 *
 * @param {string} pluginName - The name of the plugin to trigger the event for.
 * @param {string} storageName - The new storage name.
 */
function triggerStorageChange(pluginName, newStorageName) {
  prevStorageName = storageName;
  storageName = newStorageName;
  plugins[pluginName]['onStorageChange'](storageName, prevStorageName);
}

/**
 * Trigger an event on all loaded plugins.
 *
 * @param {string} eventName - The name of the event.
 * @param {array} ...args - The arguments to pass to the event handler.
 */
export function triggerPluginEvent(eventName, ...args) {
  Object.keys(plugins).forEach((pluginName) => {
    if (typeof plugins[pluginName][eventName] === 'function') {
      if (eventName === 'onStorageChange') {
        triggerStorageChange(pluginName, ...args);
      } else {
        plugins[pluginName][eventName](...args);
      }
    }
  });
}

/**
 * Trigger an event on a single named plugin. Used when an event has a known
 * recipient (e.g. a worker message belongs to the plugin that registered that
 * language) and fanning it out to every plugin would be wrong.
 *
 * @param {string} pluginName - The name of the plugin to trigger the event on.
 * @param {string} eventName - The name of the event.
 * @param {array} ...args - The arguments to pass to the event handler.
 */
export function triggerPluginEventFor(pluginName, eventName, ...args) {
  const plugin = plugins[pluginName];
  if (plugin && typeof plugin[eventName] === 'function') {
    plugin[eventName](...args);
  }
}


/**
 * Get a plugin by name.
 *
 * @param {string} name - The name of the plugin to retrieve.
 * @throws {Error} - When the plugin does not exist.
 */
export function getPlugin(name) {
  if (!plugins.hasOwnProperty(name)) {
    throw new Error(`Plugin with name "${name}" does not exist.`);
  }

  return plugins[name];
}
