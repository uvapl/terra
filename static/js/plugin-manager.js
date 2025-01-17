class TerraPluginManager {
  /**
   * Contains a reference to all loaded plugins.
   * @type {object}
   */
  plugins = {};

  /**
   * Register a plugin.
   *
   * @param {object} plugin - A valid plugin object.
   */
  register(plugin) {
    this.plugins[plugin.name] = plugin;
  }

  /**
   * Trigger an event on all plugins.
   *
   * @param {string} eventName - The name of the event.
   * @param {array} ...args - The arguments to pass to the event handler.
   */
  triggerEvent(eventName, ...args) {
    for (const plugin of Object.values(this.plugins)) {
      if (typeof plugin[eventName] === 'function') {
        plugin[eventName](...args);
      }
    }
  }
}

Terra.pluginManager = new TerraPluginManager();
