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

  // ── Layout API (exam-specific) ──

  /** @returns {object<string, string>} The hidden (never-shown) files. */
  get hiddenFiles() {
    return this.layout.hiddenFiles;
  }

  setPageTitle(courseName, examName) {
    this.layout.setPageTitle(courseName, examName);
  }

  showSubmitButton(onSubmitClick) {
    this.layout.showSubmitButton(onSubmitClick);
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
