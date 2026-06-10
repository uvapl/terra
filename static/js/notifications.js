let notifyTimeoutId = null;

/**
 * Render a given message inside the notification container in the UI.
 *
 * @param {string} msg - The message to be displayed.
 * @param {object} options - Additional options for the notification.
 * @param {string} options.type - The type of notification (e.g. 'error').
 * @param {number} options.fadeOutAfterMs - The time in milliseconds to fade.
 */
export function notify(msg, options = {}) {
  if (notifyTimeoutId !== null) {
    clearTimeout(notifyTimeoutId);
    notifyTimeoutId = null;
  }

  const $msgContainer = $('.msg-container');

  if (options.type === 'error') {
    $msgContainer.addClass('error');
  }

  $msgContainer.html(`<span>${msg}</span>`);

  if (options.fadeOutAfterMs) {
    notifyTimeoutId = setTimeout(() => {
      $('.msg-container span').fadeOut();
    }, options.fadeOutAfterMs);
  }
}

/**
 * Wrapper to render a notification as an error type.
 *
 * @param {string} msg - The message to be displayed.
 * @param {object} options - Additional options for the notification.
 */
export function notifyError(msg, options) {
  notify(msg, { ...options, type: 'error' });
}
