import BaseController from './base.js';
import EmbedLayout from '../layouts/layout.embed.js';

/**
 * Controller for the Embed app variant.
 */
export default class EmbedController extends BaseController {
  buildLayout(options) {
    return new EmbedLayout(options);
  }
}
