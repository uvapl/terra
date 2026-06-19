import BaseController from './base.js';
import IDELayout from '../layouts/layout.ide.js';

/**
 * Controller for the IDE app variant.
 */
export default class IDEController extends BaseController {
  buildLayout(options) {
    return new IDELayout(options);
  }

  /**
   * Strip editor contents before persisting: the IDE reloads file contents from
   * the VFS on restore, so only pathless (Untitled) tabs need to keep their
   * value.
   *
   * @param {object} config - The GoldenLayout config from layout.toConfig().
   * @returns {object} The config to persist, with saved editors' values removed.
   */
  serializeLayoutConfig(config) {
    return this._removeEditorValue(config);
  }

  _removeEditorValue(config) {
    if (config.content) {
      config.content.forEach((item) => {
        if (item.type === 'component') {
          // Keep the value of pathless (Untitled) tabs, because those cannot
          // be reloaded from the VFS.
          if (item.componentState.path) {
            item.componentState.value = '';
          }
        } else {
          this._removeEditorValue(item);
        }
      });
    }
    return config;
  }
}
