import BaseController from './base.js';
import LabLayout from '../layouts/layout.lab.js';

/**
 * Controller for the Lab app variant.
 */
export default class LabController extends BaseController {
  buildLayout(options) {
    return new LabLayout(options);
  }

  setPageTitle(config) {
    this.layout.setPageTitle(config);
  }
}
