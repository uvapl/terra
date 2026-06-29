import BaseController from './base.js';
import ExamLayout from '../layouts/layout.exam.js';

/**
 * Controller for the Exam app variant.
 */
export default class ExamController extends BaseController {
  buildLayout(options) {
    // Exam defaults to a horizontal layout (editor and terminal side-by-side).
    return new ExamLayout({ orientation: 'horizontal', ...options });
  }

  setupCommandSurfaces() {
    // Exam has no menubar, but it does have global keyboard shortcuts (clear).
    this.surfaces.installGlobalKeyboard();
  }

  /**
   * Remove the right navbar when the app failed to initialise. Static because no
   * controller/layout instance exists yet at that point.
   */
  static removeNavbar() {
    ExamLayout.removeNavbar();
  }

  // ── Layout API (exam-specific) ──

  /** @returns {object<string, string>} The hidden (never-shown) files. */
  get hiddenFiles() {
    return this.layout.hiddenFiles;
  }

  setPageTitle(courseName, examName) {
    this.layout.setPageTitle(courseName, examName);
  }

  showNavbar(onSubmitClick) {
    this.layout.showNavbar(onSubmitClick);
  }

  showLockedState(options) {
    this.layout.showLockedState(options);
  }

  showSubmitExamModal(options) {
    this.layout.showSubmitExamModal(options);
  }

  setSubmitModalSuccess(options) {
    this.layout.setSubmitModalSuccess(options);
  }
}
