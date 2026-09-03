import BaseController from './base.js';
import CourseLayout from '../layouts/layout.course.js';

/**
 * Controller for a session on a piece of coursework, on both the exam and the
 * lab page. The page picks the default orientation and passes it through.
 */
export default class CourseController extends BaseController {
  buildLayout(options) {
    return new CourseLayout(options);
  }

  setupCommandSurfaces() {
    // Neither page has a menubar, but both have global keyboard shortcuts
    // (clear).
    this.surfaces.installGlobalKeyboard();
  }

  // ── Layout API ──

  setPageTitle(config, pageName) {
    this.layout.setPageTitle(config, pageName);
  }

  showSubmitButton(onSubmitClick) {
    this.layout.showSubmitButton(onSubmitClick);
  }

  showLockedState(options) {
    this.layout.showLockedState(options);
  }

  showSubmitModal(options) {
    this.layout.showSubmitModal(options);
  }

  setSubmitModalSuccess(options) {
    this.layout.setSubmitModalSuccess(options);
  }
}
