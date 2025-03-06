Terra.app = new ExamApp();
Terra.app.setupLayout()
  .then(({ layout, config }) => {
    layout.on('initialised', () => onAppInit(config));
    layout.init();
  }).catch((err) => {
    console.error('Failed to bootstrap exam app:', err);

    // Remove the right navbar when the application failed to initialise.
    $('.navbar-right').remove();
  });

function onAppInit(config) {
  Terra.v.editorIsDirty = false;

  if (config.course_name && config.exam_name) {
    $('.page-title').html(`
      <span class="course-name">${config.course_name}</span>
      <span class="exam-name">${config.exam_name}</span>
    `);
  }

  // Register the auto-save after a certain auto-save offset time to prevent
  // the server receives many requests at once. This helps to spread them out
  // over a minute of time.
  const startTimeout = Terra.f.getRandNumBetween(0, Terra.c.AUTOSAVE_START_OFFSET);
  setTimeout(() => {
    Terra.app.registerAutoSave(config.postback, config.code);
  }, startTimeout);

  // Make the right navbar visible and add the click event listener to the
  // submit button.
  $('.navbar-right')
    .removeClass('hidden')
    .find('#submit-btn')
    .click(Terra.app.showSubmitExamModal);

  // Immediately lock everything if this exam is locked.
  if (config.locked === true) {
    Terra.app.lock();
  }

  // Catch ctrl-w and cmd-w to prevent the user from closing the tab.
  $(window).on('beforeunload', (e) => {
    const message = 'Are you sure you want to leave this page?';
    e.preventDefault();
    e.returnValue = message;
    return message;
  });
}
