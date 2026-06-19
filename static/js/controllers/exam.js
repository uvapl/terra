import BaseController from './base.js';
import ExamLayout from '../layouts/layout.exam.js';

/**
 * Controller for the Exam app variant.
 */
export default class ExamController extends BaseController {
  buildLayout(options) {
    return new ExamLayout(options);
  }
}
