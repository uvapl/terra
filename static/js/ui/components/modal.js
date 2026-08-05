import { isObject, uuidv4 } from '../../lib/helpers.js';

/**
 * Build the default footer HTML: a `.cancel-btn` and/or `.confirm-btn`,
 * whichever labels are given. A single button is right-aligned; two are
 * spaced apart (see modal.css). Returns null when neither label is given, so
 * the caller can fall back to a fully custom `footer` string.
 *
 * @param {object} options
 * @param {string} [options.cancelLabel]
 * @param {string} [options.confirmLabel]
 * @param {boolean} [options.danger]
 * @returns {?{ html: string, class: string }}
 */
function buildDefaultFooter({ cancelLabel, confirmLabel, danger }) {
  const buttons = [];

  if (cancelLabel) {
    buttons.push(`<button type="button" class="button cancel-btn">${cancelLabel}</button>`);
  }

  if (confirmLabel) {
    buttons.push(`<button type="button" class="button confirm-btn primary-btn${danger ? ' danger-btn' : ''}">${confirmLabel}</button>`);
  }

  if (buttons.length === 0) {
    return null;
  }

  return {
    html: buttons.join('\n'),
    class: buttons.length === 1 ? 'flex-end' : '',
  };
}

/**
 * Create a new modal, append its HTML to the body, show it, and return it.
 *
 * The footer is almost always zero, one, or two buttons — a cancel-ish action
 * and/or a confirm-ish one. Pass `cancelLabel`/`confirmLabel` to get that
 * built (and wired to onCancel/onConfirm) automatically; pass a raw `footer`
 * HTML string instead for anything more custom.
 *
 * @param {object} modalOptions - Modal options that creates the modal.
 * @param {string} modalOptions.title - The title HTML of the modal.
 * @param {string} modalOptions.body - The body HTML of the modal.
 * @param {string} [modalOptions.cancelLabel] - Label for a `.cancel-btn`.
 * Omit for no cancel button.
 * @param {string} [modalOptions.confirmLabel] - Label for a `.confirm-btn`.
 * Omit for no confirm button.
 * @param {boolean} [modalOptions.danger=false] - Style the confirm button as
 * destructive.
 * @param {string} [modalOptions.footer] - Raw footer HTML, overriding
 * cancelLabel/confirmLabel for fully custom footers.
 * @param {string} [modalOptions.footerClass] - Additional footer container
 * classes, overriding the automatic single-button alignment.
 * @param {object} modalOptions.attrs - Object with additional attributes.
 * @param {object} [modalOptions.attrs.id] - The ID of the outer container.
 * @param {object} [modalOptions.attrs.class] - Optional container classes.
 * @param {object} [modalOptions.focus] - Field to focus once the modal opens.
 * @param {string} modalOptions.focus.selector - CSS selector (scoped to the
 * modal) of the field to focus.
 * @param {boolean} [modalOptions.focus.select=false] - Also select the
 * field's text (e.g. for an editable filename).
 * @param {function} [modalOptions.onConfirm] - Bound to the `.confirm-btn`.
 * May be async. The modal closes once it resolves, unless it resolves to
 * exactly `false` (e.g. failed validation) — omit to just close on click with
 * no side effect.
 * @param {function} [modalOptions.onCancel] - Same as onConfirm, bound to the
 * `.cancel-btn`.
 * @returns {HTMLDialogElement} The modal element.
 */
export function createModal(modalOptions = {}) {
  if (!isObject(modalOptions.attrs)) {
    modalOptions.attrs = {}
  }

  modalOptions.attrs.class = ['modal', (modalOptions.attrs.class || '')].join(' ');

  if (!modalOptions.attrs.id) {
    modalOptions.attrs.id = uuidv4();
  }

  const attrsString = Object.keys(modalOptions.attrs)
    .map((key) => `${key}="${modalOptions.attrs[key]}"`)
    .join(' ');

  // A same-id modal from a previous open may still be mid-close (hideModal
  // defers removal until its animation finishes). Evict it synchronously so
  // getElementById below can never resolve to that stale node instead of the
  // one just created — otherwise a fast reopen attaches a second set of
  // listeners to the old element rather than the new one.
  document.getElementById(modalOptions.attrs.id)?.remove();

  const defaultFooter = modalOptions.footer ? null : buildDefaultFooter(modalOptions);
  const footerHtml = modalOptions.footer || defaultFooter?.html;
  const footerClasses = ['modal-footer']
    .concat(modalOptions.footerClass || defaultFooter?.class || [])
    .join(' ');
  const footer = footerHtml ? `<div class="${footerClasses}">${footerHtml}</div>` : '';

  const html = `
    <dialog ${attrsString}>
      <div class="modal-header">
        <p class="modal-title">${modalOptions.title}</p>
      </div>
      <div class="modal-body">${modalOptions.body}</div>
      ${footer}
    </dialog>
  `;

  document.body.insertAdjacentHTML('beforeend', html);

  const dialog = document.getElementById(modalOptions.attrs.id);

  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      dialog.querySelector('.modal-footer .primary-btn')?.click();
    }
  });

  // A `.cancel-btn`/`.confirm-btn` in the footer closes the modal on click by
  // default; an onCancel/onConfirm handler (if given) runs first and can veto
  // the close by resolving to exactly `false` (e.g. failed validation).
  const wireCloseButton = (selector, handler) => {
    dialog.querySelector(selector)?.addEventListener('click', async () => {
      const keepOpen = handler ? (await handler()) === false : false;
      if (!keepOpen) hideModal(dialog);
    });
  };
  wireCloseButton('.cancel-btn', modalOptions.onCancel);
  wireCloseButton('.confirm-btn', modalOptions.onConfirm);

  dialog.showModal();

  if (modalOptions.focus?.selector) {
    const field = dialog.querySelector(modalOptions.focus.selector);
    field?.focus();
    if (modalOptions.focus.select) {
      field?.select?.();
    }
  }

  return dialog;
}

/**
 * Hide a modal. It is removed from the DOM once its close animation finishes.
 *
 * @param {HTMLDialogElement} dialog - The modal element reference.
 */
export function hideModal(dialog) {
  dialog.close();

  // The animation is CSS-driven (see modal.css); wait for it to finish before
  // removing the element. The timeout is a fallback for when the transition
  // never fires (e.g. a backgrounded tab pausing rAF) — remove() on an
  // already-detached node is a no-op, so whichever fires first wins.
  const remove = () => dialog.remove();
  dialog.addEventListener('transitionend', remove, { once: true });
  setTimeout(remove, 300);
};
