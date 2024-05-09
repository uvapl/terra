////////////////////////////////////////////////////////////////////////////////
// This file contains the logic for the menubar at the top of the IDE app.
////////////////////////////////////////////////////////////////////////////////


$(document).ready(() => {
  $('.menubar [data-keystroke]').each((_, element) => setMenubarKeystrokeIcons(element));
  registerMenubarEventListeners();
});

// ===========================================================================
// Functions
// ===========================================================================

/**
 * Replaces the `data-keystroke` attribute with the appropriate symbols for a
 * single list-item in the menubar.
 *
 * @param {DOMElement} element - One list-item from the menubar.
 */
function setMenubarKeystrokeIcons(element) {
  const keystroke = $(element).data('keystroke')
    .replace('CTRL_META', isMac() ? '\u2318' : 'Ctrl')
    .replace('ALT_OPTION', isMac() ? '\u2325' : 'Alt')
    .replace('SHIFT', '\u21E7')
    .replace('ENTER', '\u23CE')
    .replace('UP', '\u2191')
    .replace('DOWN', '\u2193')
    .replace('LEFT', '\u2190')
    .replace('RIGHT', '\u2192');

  const currentText = $(element).text();
  $(element).html(`
    <span class="text">${currentText}</span>
    <span class="keystroke">${keystroke}</span>
  `);
}

/**
 * Registers onclick handlers for all actions in the menubar as well as global
 * keyboard shortcuts in the document.
 */
function registerMenubarEventListeners() {
  // Main menu items.
  // ================
  const closeActiveMenu = () => $('.menubar > li.open').removeClass('open');

  // Open the first menu level when clicking the main menubar items.
  $('.menubar > li').click((event) => {
    // Check if the clicked item is one of the menubar children.
    const $listItem = $(event.target);
    if ($listItem.parent().hasClass('menubar')) {
      $listItem.toggleClass('open').siblings().removeClass('open');
    }
  });

  // Close menu when clicking outside of it.
  $(document).click((event) => {
    if (!$(event.target).closest('.menubar').length) {
      closeActiveMenu();
    }
  });

  // Close menu when pressing ESC.
  $(document).keydown((event) => {
    if (event.key === 'Escape') {
      closeActiveMenu();
    }
  });

  // Close menu when clicking on a menu item.
  $('.menubar > li li:not(.disabled)').click(() => {
    closeActiveMenu();
  });

  // All submenu item event listeners.
  // =================================
  $('#menu-item--new-file').click(openNewFile);
  Mousetrap.bind(['ctrl+n', 'meta+n'], openNewFile);

  $('#menu-item--close-file').click(closeFile);
  Mousetrap.bind(['ctrl+w', 'meta+w'], closeFile);

  $('#menu-item--undo').click(undo);
  $('#menu-item--redo').click(redo);

  $('#menu-item--copy').click(copy);
  $('#menu-item--cut').click(cut);
  $('#menu-item--paste').click(paste);

  $('#menu-item--indent').click(indent);
  $('#menu-item--unindent').click(unindent);

  $('#menu-item--search').click(search);
  $('#menu-item--replace').click(replace);

  $('#menu-item--run-tab').click(runTab);
}

function openNewFile() { console.log('TODO: open new file') }
function closeFile() { console.log('TODO: close file') }

function undo() {
  getActiveEditor().instance.editor.undo();
}

function redo() {
  getActiveEditor().instance.editor.redo();
}

function copy() {
  const editor = getActiveEditor().instance.editor;
  if (!editor.selection.isEmpty()) {
    const text = editor.getSelectedText();
    navigator.clipboard.writeText(text);
  }
}

function cut() {
  copy();

  // Cut the selected text.
  getActiveEditor().instance.editor.insert('');
}

function paste() {
  navigator.clipboard.readText().then((text) => {
    getActiveEditor().instance.editor.insert(text);
  });
}

function indent() {
  getActiveEditor().instance.editor.blockIndent();
}

function unindent() {
  getActiveEditor().instance.editor.blockOutdent();
}

function search() {
  getActiveEditor().instance.editor.execCommand('find');
}

function replace() {
  getActiveEditor().instance.editor.execCommand('replace');
}

function runTab() { console.log('TODO: run tab') }
