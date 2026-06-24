import BaseController from './base.js';
import LabLayout from '../layouts/layout.lab.js';
import labCommandConfig from '../commands/config.lab.js';

/**
 * Controller for the Lab app variant.
 */
export default class LabController extends BaseController {
  buildLayout(options) {
    return new LabLayout(options);
  }

  registerCommands() {
    this.delegate.commands.register(labCommandConfig.commands);

    // Lab has no menubar, but it does have a global keyboard shortcut (clear).
    this.surfaces.installGlobalKeyboard();
  }

  setPageTitle(config) {
    this.layout.setPageTitle(config);
  }
}
