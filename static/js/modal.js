import { isObject, uuidv4 } from './helpers/shared.js';
import { MODAL_ANIM_DURATION } from './constants.js';

/**
 * Create a new modal, append its HTML to the body, and returns the new modal.
 *
 * @param {object} modalOptions - Modal options that creates the modal.
 * @param {string} modalOptions.title - The title HTML of the modal.
 * @param {string} modalOptions.body - The body HTML of the modal.
 * @param {string} modalOptions.footer - The footer HTML of the modal.
 * @param {string} modalOptions.footerClass - Additional footer container classes.
 * @param {object} modalOptions.attrs - Object with additional attributes.
 * @param {object} modalOptions.attrs.id - The ID of the outer container.
 * @param {object} [modalOptions.attrs.class] - Optional container classes.
 * @returns {jQuery} The modal element.
 */
export function createModal(modalOptions = {}) {
  if (!isObject(modalOptions.attrs)) {
    modalOptions.attrs = {}
  }

  modalOptions.attrs.class = ['modal', (modalOptions.attrs.class || '')].join(' ');

  const attrsString = Object.keys(modalOptions.attrs)
    .map((key) => `${key}="${modalOptions.attrs[key]}"`)
    .join(' ');

  if (!modalOptions.attrs.id) {
    modalOptions.attrs.id = uuidv4();
  }

  const footerClasses = ['modal-footer'].concat(modalOptions.footerClass || []).join(' ');
  const footer = modalOptions.footer ? `<div class="${footerClasses}">${modalOptions.footer}</div>` : '';

  const html = `
    <div ${attrsString} tabindex="-1">
      <div class="modal-content">
        <div class="modal-header">
          <p class="modal-title">${modalOptions.title}</p>
        </div>
        <div class="modal-body">${modalOptions.body}</div>
        ${footer}
      </div>
    </div>
  `;

  $('body').append(html);

  const $modal = $(`#${modalOptions.attrs.id}`);

  // Focus the modal such that the keydown listener works immediately.
  $modal.focus();

  $modal.off('keydown').on('keydown', (e) => {
    if (e.key === 'Enter') {
      $modal.find('.modal-footer .primary-btn').click();
    }
  });

  return $modal;
}

/**
 * Hide a modal and remove it completely from the DOM after the animation.
 *
 * @param {jQuery} $modal - The modal element reference.
 * @param {boolean} [remove=true] - Whether to remove the modal after hiding.
 */
export function hideModal($modal, remove = true) {
  $modal.removeClass('show');

  if (remove) {
    // Wait for animation to be completed.
    setTimeout(() => {
      $modal.remove();
    }, MODAL_ANIM_DURATION);
  }
};

/**
 * Show a given model element.
 *
 * @param {jQuery} $modal - The modal element reference.
 * @returns {Promise<void>} Resolves after the model has been shown.
 */
export function showModal($modal) {
  return new Promise((resolve) => {
    // Use setTimeout trick to add the class after the modal HTML has been
    // rendered to the DOM to show the fade-in animation.
    setTimeout(() => $modal.addClass('show'), 10);

    setTimeout(() => resolve(), MODAL_ANIM_DURATION);
  })
}
