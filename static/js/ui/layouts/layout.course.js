import { formatDate } from '../../lib/helpers.js';
import { createModal } from '../components/modal.js';
import Layout from './layout.js';
import { createTabConfig } from './tab-config.js';

/**
 * Layout for a session on a piece of coursework, on both the exam and the lab
 * page. The submit and lock visuals below only come into play on a session
 * connected to a course-site.
 */
export default class CourseLayout extends Layout {
  tabsClosable = false;

  /**
   * Create the layout. When the session has a README, it is rendered in a
   * fixed sidebar next to the layout container and is not part of the
   * GoldenLayout structure.
   *
   * @param {object} options - Controller-supplied options.
   * @param {array<string>} options.files - Filenames to open as tabs.
   * @param {number} options.fontSize - The default font-size to be used.
   */
  constructor(options = {}) {
    const { files, fontSize } = options;

    // The file contents are not embedded: every source the session has is
    // written to the VFS before the layout is built, and each editor loads
    // its file from there when it is shown.
    const content = files.map((filename) => createTabConfig({
      title: filename,
      isClosable: false,
      componentState: { path: filename },
    }, { fontSize }));

    // A lab without files (e.g. the minimal `lab: true` form) still needs
    // at least one tab in the editor stack.
    if (content.length === 0) {
      content.push(createTabConfig({ isClosable: false }, { fontSize }));
    }

    const defaultLayoutConfig = {
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
   * Render the name of the coursework in the page title, prefixed by the
   * course name when the course-site supplied one.
   *
   * @param {object} config - The resolved config.
   * @param {string} [pageName] - The page's own name, used as the suffix of
   * the browser tab title.
   */
  setPageTitle(config, pageName) {
    const name = config.exam_name || config.name;
    if (!name) return;

    if (config.course_name) {
      $('.page-title').html(`
        <span class="course-name">${config.course_name}</span>
        <span class="coursework-name">${name}</span>
      `);
    } else {
      $('.page-title').text(name);
    }

    document.title = pageName ? `${name} - ${pageName}` : name;
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
   * Show all lock visuals, which gets triggered once submission is closed.
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
   * @param {boolean} [options.isLab] - Whether this session is a lab, which
   * has no invigilated desk to sign off at.
   */
  showSubmitModal({ prevAutoSaveTime, isLab } = {}) {
    let lastSaveText = '';
    if (prevAutoSaveTime instanceof Date) {
      lastSaveText += `<br/>🛅 Previous successful submit was at <span class="last-save">${formatDate(prevAutoSaveTime)}</span>.<br/>`;
    }

    const dialog = createModal({
      title: "You're done!",
      body: '<div class="spinner"></div>',
      confirmLabel: isLab ? 'Return to lab' : 'Return to exam',
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
        <p>You can still return to your code if you would like to make more changes.</p>
      `;
    }, 1300);
  }

  /**
   * Render the success message in the submit modal, if it is open.
   *
   * @param {object} options - Additional options object.
   * @param {string} [options.evalLink] - URL of the course evaluation form.
   * @param {boolean} [options.isLab] - Whether this session is a lab.
   */
  setSubmitModalSuccess({ evalLink, isLab } = {}) {
    const dialog = document.getElementById('submit-exam-model');
    if (!dialog) return;

    this.cancelSubmitPendingMessage();

    const signOff = isLab
      ? ''
      : '<br/><br/>🛂 Make sure that you sign off at the desk before leaving';

    const evaluationFormLink = evalLink
      ? `<br/><br/>🙏 <a href="${evalLink}" target="_blank">Fill in the evaluation form for the course</a>`
      : '';

    dialog.querySelector('.modal-body').innerHTML = `
      <p>
        ✅ Your files have been submitted successfully${signOff}
        ${evaluationFormLink}
      </p>
      <p>You can still return to your code if you would like to make more changes.</p>
    `;
  }

  /**
   * Cancel the pending "trying to submit" message in the submit modal.
   */
  cancelSubmitPendingMessage() {
    clearTimeout(this.submitPendingMsgTimeoutId);
  }
}
