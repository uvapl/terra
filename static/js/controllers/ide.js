import BaseController from './base.js';
import IDELayout from '../layouts/layout.ide.js';
import ideCommandConfig from '../commands/config.ide.js';
import { initMenubar } from '../components/menubar.js';

/**
 * Controller for the IDE app variant.
 */
export default class IDEController extends BaseController {
  buildLayout(options) {
    return new IDELayout(options);
  }

  /**
   * Register the IDE command config and, because the IDE has a menubar and
   * global keyboard shortcuts, build the menubar and install the global
   * keyboard. Runs from the base constructor, before the layout is built; the
   * run button itself is placed later when the layout renders.
   */
  registerCommands() {
    this.delegate.commands.register(ideCommandConfig.commands, {
      submenus: ideCommandConfig.submenus,
      rawItems: ideCommandConfig.rawItems,
    });

    this.surfaces.buildMenu('.menubar');
    initMenubar();
    this.surfaces.installGlobalKeyboard();
  }

  /**
   * Reset the layout: snapshot the open tabs, destroy the current layout and
   * build a fresh default one that re-opens those tabs. The controller instance
   * persists; only its `this.layout` is swapped. The caller is responsible for
   * (re)initialising the new layout via `this.layout.init()`.
   *
   * @returns {IDELayout} The replacement layout.
   */
  recreate() {
    this.setFontSizeDefault();
    const contentConfig = this.layout.serializeTabs();

    // Prevent the dying layout from auto-inserting an Untitled tab as its tabs
    // are torn down.
    this.layout.resetLayout = true;
    this.layout.destroy();

    this.createLayout({ forceDefaultLayout: true, contentConfig });

    // The next init() is a reset: tell onReady() to fire afterLayoutReset.
    this._pendingReset = true;

    // return this.layout;
    this.init();
  }

  // ── Layout API (IDE-specific) ──

  setProjectMenuState(state) {
    this.layout.setProjectMenuState(state);
  }

  showSaveFileModal(options) {
    this.layout.showSaveFileModal(options);
  }

  closeFile(filepath) {
    this.layout.closeFile(filepath);
  }

  closeAllTabs() {
    this.layout.closeAllTabs();
  }

  closeFilesFromFolder(path) {
    this.layout.closeFilesFromFolder(path);
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
