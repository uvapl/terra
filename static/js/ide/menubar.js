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
    .replace('CTRL', isMac() ? '\u2303' : 'Ctrl')
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
  $('#menu-item--new-file').click(() => createNewFileTreeFile());
  Mousetrap.bind(['ctrl+t'], () => createNewFileTreeFile());

  $('#menu-item--new-folder').click(() => createNewFileTreeFolder());
  Mousetrap.bind(['ctrl+shift+t'], () => createNewFileTreeFolder());

  $('#menu-item--close-file').click(closeFile);
  Mousetrap.bind(['ctrl+w'], closeFile);

  $('#menu-item--undo').click(Menubar.undo);
  $('#menu-item--redo').click(Menubar.redo);

  $('#menu-item--copy').click(Menubar.copyToClipboard);
  $('#menu-item--cut').click(Menubar.cut);
  $('#menu-item--paste').click(Menubar.pasteFromClipboard);

  $('#menu-item--indent').click(Menubar.indent);
  $('#menu-item--outdent').click(Menubar.outdent);

  $('#menu-item--search').click(Menubar.search);
  Mousetrap.bind(['ctrl+f', 'meta+f'], Menubar.search);

  $('#menu-item--replace').click(Menubar.replace);

  $('#menu-item--run-tab').click(Menubar.runTab);
}

const Menubar = {};

Menubar.openNewFile = () => {
  createNewFileTreeFile();
}

Menubar.undo = () => {
  getActiveEditor().instance.editor.undo();
}

Menubar.redo = () => {
  getActiveEditor().instance.editor.redo();
}

Menubar.copyToClipboard = () => {
  const editor = getActiveEditor().instance.editor;
  if (!editor.selection.isEmpty()) {
    const text = editor.getSelectedText();
    navigator.clipboard.writeText(text);
  }
}

Menubar.cut = () => {
  copyToClipboard();

  // Cut the selected text.
  getActiveEditor().instance.editor.insert('');
}

Menubar.pasteFromClipboard = () => {
  navigator.clipboard.readText().then((text) => {
    getActiveEditor().instance.editor.insert(text);
  });
}

Menubar.indent = () => {
  getActiveEditor().instance.editor.blockIndent();
}

Menubar.outdent = () => {
  getActiveEditor().instance.editor.blockOutdent();
}

Menubar.search = () => {
  getActiveEditor().instance.editor.execCommand('find');
}

Menubar.replace = () => {
  getActiveEditor().instance.editor.execCommand('replace');
}

Menubar.runTab = () => {
  getActiveEditor().instance.editor.execCommand('run');
}
