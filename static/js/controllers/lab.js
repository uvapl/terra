import BaseController from './base.js';
import LabLayout from '../layouts/layout.lab.js';

/**
 * Controller for the Lab app variant.
 */
export default class LabController extends BaseController {
  buildLayout(options) {
    return new LabLayout(options);
  }

  setupCommandSurfaces() {
    // Lab has no menubar, but it does have a global keyboard shortcut (clear).
    this.surfaces.installGlobalKeyboard();
  }

  setPageTitle(config) {
    this.layout.setPageTitle(config);
  }
}
