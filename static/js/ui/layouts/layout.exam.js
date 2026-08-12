import { formatDate, isObject } from '../../lib/helpers.js';
import { createModal } from '../components/modal.js';
import Layout from './layout.js';
import { createTabConfig } from './tab-config.js';

export default class ExamLayout extends Layout {
  tabsClosable = false;

  /**
   * Create the layout.
   *
   * @param {array} content - List of content objects.
   * @param {number} fontSize - The default font-size to be used.
   * @param {object} options - Additional options object.
   */
  constructor(options = {}) {
    const { tabs, fontSize } = options;

    // Create the config for each tab.
    const content = Object.keys(tabs).map((filename) => createTabConfig({
      title: filename,
      isClosable: false,
      componentState: {
        value: tabs[filename],
        path: filename,
      },
    }, { fontSize }));

    const defaultLayoutConfig = {
      settings: {
        reorderEnabled: false,
      },
      header: {
        popout: false,
        maximise: false,
      },
      root: {
        content: [
          { content },
          {
            componentState: { fontSize },
          }
        ]
      }
    };

    super(defaultLayoutConfig, options);
  }

  /**
   * Customize layout as loaded.
   */
  initCustomContent() {
    const settingsMenuHtml = this.getSettingsMenuHtml();

    // The run and clear buttons are built into the static `#toolbar` by the
    // controller's buildToolbar pass; only the settings dropdown and the
    // data-driven config buttons are placed here.
    $('.terminal-component-container').find('.lm_controls').append(settingsMenuHtml);

    const $header = $('.terminal-component-container').find('.lm_header');
    $header.append(`<div class="toolbar" id="toolbar"></div>`);
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
   * Reveal the submit button and add its click event listener.
   *
   * @param {function} onSubmitClick - Callback for the submit button.
   */
  showSubmitButton(onSubmitClick) {
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
    const submitModal = document.getElementById('submit-exam-model');
    if (submitModal) {
      let lastSubmissionText = '';
      if (prevAutoSaveTime instanceof Date) {
        lastSubmissionText = `<br/><br/>✅ The last successful submit was at ${formatDate(prevAutoSaveTime)}.`;
      }

      submitModal.querySelector('.modal-body').innerHTML = `❌ The submission was locked since the last submit. ${lastSubmissionText}`;
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

    const dialog = createModal({
      title: "You're done!",
      body: '<div class="spinner"></div>',
      confirmLabel: 'Return to exam',
      attrs: { id: 'submit-exam-model' },
      onConfirm: () => this.cancelSubmitPendingMessage(),
    });

    // If for some reason the auto-save POST request takes more than 1 second,
    // we will show a message to the user.
    //
    // interval = 300ms for the opening transition to be completed + 1 second of
    // time to wait for the POST request. If the submission was successful, then
    // this timeout will be cleared automatically.
    this.submitPendingMsgTimeoutId = setTimeout(() => {
      dialog.querySelector('.modal-body').innerHTML = `
        <p>
          🈲 NOTE: DO NOT CLOSE THIS BROWSER WINDOW<br/><br/>
          🛄 Trying to submit your final changes to the server.<br/>
          ${lastSaveText}
        </p>
        <p>You can still return to the exam if you would like to make more changes to your code.</p>
      `;
    }, 1300);
  }

  /**
   * Render the success message in the submit exam modal, if it is open.
   *
   * @param {object} options - Additional options object.
   * @param {string} [options.evalLink] - URL of the course evaluation form.
   */
  setSubmitModalSuccess({ evalLink } = {}) {
    const dialog = document.getElementById('submit-exam-model');
    if (!dialog) return;

    this.cancelSubmitPendingMessage();

    const evaluationFormLink = evalLink
      ? `<br/><br/>🙏 <a href="${evalLink}" target="_blank">Fill in the evaluation form for the course</a>`
      : '';

    dialog.querySelector('.modal-body').innerHTML = `
      <p>
        ✅ Your files have been submitted successfully<br/><br/>
        🛂 Make sure that you sign off at the desk before leaving
        ${evaluationFormLink}
      </p>
      <p>You can still return to the exam if you would like to make more changes to your code.</p>
    `;
  }

  /**
   * Cancel the pending "trying to submit" message in the submit exam modal.
   */
  cancelSubmitPendingMessage() {
    clearTimeout(this.submitPendingMsgTimeoutId);
  }
}
