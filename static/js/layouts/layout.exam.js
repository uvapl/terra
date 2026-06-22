import { formatDate } from '../lib/helpers.js';
import { createModal, hideModal, showModal } from '../components/modal.js';
import Layout from './layout.js';

export default class ExamLayout extends Layout {
  tabsClosable = false;

  /**
   * Create the layout.
   *
   * @param {array} content - List of content objects.
   * @param {number} fontSize - The default font-size to be used.
   * @param {object} options - Additional options object.
   * @param {object} options.buttonConfig - Object containing buttons with their
   * commands that will be rendered by the layout.
   */
  constructor(options = {}) {
    const { tabs, fontSize } = options;

    // Create the config for each tab.
    const content = Object.keys(tabs).map((filename) => ({
      type: 'component',
      componentName: 'editor',
      componentState: {
        fontSize,
        value: tabs[filename],
        path: filename,
      },
      title: filename,
      isClosable: false,
    }));

    const defaultLayoutConfig = {
      settings: {
        showPopoutIcon: false,
        showMaximiseIcon: false,
        showCloseIcon: false,
        reorderEnabled: false,
      },
      content: [
        {
          content: [
            { content },
            {
              componentState: { fontSize },
            }
          ]
        }
      ]
    };

    super(defaultLayoutConfig, options);
  }

  renderButtons() {
    const runCodeButtonHtml = this.getRunCodeButtonHtml();
    const clearTermButtonHtml = this.getClearTermButtonHtml();
    const settingsMenuHtml = this.getSettingsMenuHtml();

    // Add run-code, clear-term and settings menu to the DOM.
    const $terminalContainer = $('.terminal-component-container');
    $terminalContainer.find('.lm_header').append(runCodeButtonHtml).append(clearTermButtonHtml);
    $terminalContainer.find('.lm_controls').append(settingsMenuHtml);

    this.renderConfigButtons();
    this.addActiveStates();
    this.addButtonEventListeners();
  }

  /**
   * Remove the right navbar, used when the application failed to initialise.
   * Static because no layout instance exists yet at that point.
   */
  static removeNavbar() {
    $('.navbar-right').remove();
  }

  /**
   * Render the course and exam name in the page title.
   *
   * @param {string} courseName - The name of the course.
   * @param {string} examName - The name of the exam.
   */
  setPageTitle(courseName, examName) {
    if (!courseName || !examName) return;

    $('.page-title').html(`
      <span class="course-name">${courseName}</span>
      <span class="exam-name">${examName}</span>
    `);
  }

  /**
   * Make the right navbar visible and add the click event listener to the
   * submit button.
   *
   * @param {function} onSubmitClick - Callback for the submit button.
   */
  showNavbar(onSubmitClick) {
    $('.navbar-right')
      .removeClass('hidden')
      .find('#submit-btn')
      .click(onSubmitClick);
  }

  /**
   * Show all lock visuals, which gets triggered once the exam is over.
   *
   * @param {object} options - Additional options object.
   * @param {Date} [options.prevAutoSaveTime] - Time of the last successful save.
   */
  showLockedState({ prevAutoSaveTime } = {}) {
    // Lock all components, making them read-only.
    this.emitToTabComponents('lock');

    // Use set-timeout to ensure these locks happen after the DOM has been
    // rendered at least once.
    setTimeout(() => {
      // Disable the controls and remove their 'click' event listeners.
      $('.terminal-component-container .button').prop('disabled', true).off('click');

      // Lock the drag handler between the editor and terminal.
      $('.lm_splitter').addClass('locked');

      // Show lock screen for both containers.
      $('.component-container').addClass('locked');
    });

    // Check if the submit modal is open.
    const $submitModal = $('#submit-exam-model');
    if ($submitModal.length > 0) {
      let lastSubmissionText = '';
      if (prevAutoSaveTime instanceof Date) {
        lastSubmissionText = `<br/><br/>✅ The last successful submit was at ${formatDate(prevAutoSaveTime)}.`;
      }

      $submitModal.find('.modal-body').html(`❌ The submission was locked since the last submit. ${lastSubmissionText}`);
    }

    $('#submit-btn').remove();
  }

  /**
   * Show the modal that does one final submit of all the contents.
   *
   * @param {object} options - Additional options object.
   * @param {Date} [options.prevAutoSaveTime] - Time of the last successful save.
   */
  showSubmitExamModal({ prevAutoSaveTime } = {}) {
    let lastSaveText = '';
    if (prevAutoSaveTime instanceof Date) {
      lastSaveText += `<br/>🛅 Previous successful submit was at <span class="last-save">${formatDate(prevAutoSaveTime)}</span>.<br/>`;
    }

    const $modal = createModal({
      title: "You're done!",
      body: '<div class="spinner"></div>',
      footer: '<button type="button" class="button dismiss-modal-btn">Return to exam</button>',
      attrs: { id: 'submit-exam-model' },
    });

    $modal.find('.dismiss-modal-btn').click(() => this.hideSubmitExamModal());

    showModal($modal);

    // If for some reason the auto-save POST request takes more than 1 second,
    // we will show a message to the user.
    //
    // interval = 300ms for the opening transition to be completed + 1 second of
    // time to wait for the POST request. If the submission was successful, then
    // this timeout will be cleared automatically.
    this.submitPendingMsgTimeoutId = setTimeout(() => {
      $modal.find('.modal-body').html(`
        <p>
          🈲 NOTE: DO NOT CLOSE THIS BROWSER WINDOW<br/><br/>
          🛄 Trying to submit your final changes to the server.<br/>
          ${lastSaveText}
        </p>
        <p>You can still return to the exam if you would like to make more changes to your code.</p>
      `);
    }, 1300);
  }

  /**
   * Hide the submit exam modal by removing it completely out of the DOM, which
   * simplifies our code a bit as we can handle a bit less.
   */
  hideSubmitExamModal() {
    const $modal = $('#submit-exam-model');

    if ($modal.length === 0) return;

    this.cancelSubmitPendingMessage();
    hideModal($modal);
  }

  /**
   * Render the success message in the submit exam modal, if it is open.
   *
   * @param {object} options - Additional options object.
   * @param {string} [options.evalLink] - URL of the course evaluation form.
   */
  setSubmitModalSuccess({ evalLink } = {}) {
    const $modal = $('#submit-exam-model');
    if ($modal.length === 0) return;

    this.cancelSubmitPendingMessage();

    const evaluationFormLink = evalLink
      ? `<br/><br/>🙏 <a href="${evalLink}" target="_blank">Fill in the evaluation form for the course</a>`
      : '';

    $modal.find('.modal-body').html(`
      <p>
        ✅ Your files have been submitted successfully<br/><br/>
        🛂 Make sure that you sign off at the desk before leaving
        ${evaluationFormLink}
      </p>
      <p>You can still return to the exam if you would like to make more changes to your code.</p>
    `);
  }

  /**
   * Cancel the pending "trying to submit" message in the submit exam modal.
   */
  cancelSubmitPendingMessage() {
    clearTimeout(this.submitPendingMsgTimeoutId);
  }
}
