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
  const closeActiveMenu = (event) => {
    // Focus the active editor tab, except for making new files/folders.
    // Check if the event.target has neither the id menu-item--new-file and
    // and menu-item--new-folder.
    const isInsideMenu = $('.menubar > li.open').find($(event.target)).length > 0;
    const isNotNewFileOrFolderBtn = !$(event.target).is('#menu-item--new-file, #menu-item--new-folder');
    if (isInsideMenu && isNotNewFileOrFolderBtn) {
      getActiveEditor().instance.editor.focus();
    }

    // Close the active menu.
    $('.menubar > li.open').removeClass('open');
  }

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
      closeActiveMenu(event);
    }
  });

  // Close menu when pressing ESC.
  $(document).keydown((event) => {
    if (event.key === 'Escape') {
      closeActiveMenu(event);
    }
  });

  // Close menu when clicking on a menu item.
  $('.menubar > li li:not(.disabled)').click((event) => {
    closeActiveMenu(event);
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

  $('#menu-item--add-credentials').click(Menubar.addCredentials);
  $('#menu-item--connect-repo').click(Menubar.connectRepo);
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
  Menubar.copyToClipboard();

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

Menubar.addCredentials = () => {
  const username = getLocalStorageItem('git-username', '');
  const $modal = createModal({
    title: 'Add GitHub credentials',
    body: `
      <div class="form-wrapper-full-width">
        <label>Username:</label>
        <input type="username" class="text-input full-width-input git-username" value="${username}"placeholder="Fill in your username" />
      </div>

      <div class="form-wrapper-full-width">
        <label>Personal access token:</label>
        <input type="password" class="text-input full-width-input git-access-token" placeholder="Fill in your personal access token" />
      </div>

      <p class="text-small">
        In order to clone private repositories or push and pull contents from any
        repository, your GitHub personal access token and username is required.
        These credentials will be stored locally in your browser and will not be
        shared with anyone.
      </p>
    `,
    footer: `
      <button type="button" class="button cancel-btn">Cancel</button>
      <button type="button" class="button primary-btn confirm-btn">Save</button>
    `,
    attrs: {
      id: 'ide-git-creds-modal',
      class: 'modal-width-small',
    }
  });

  showModal($modal);

  $modal.find('.cancel-btn').click(() => hideModal($modal));
  $modal.find('.confirm-btn').click(() => {
    const username = $modal.find('.git-username').val();
    const accessToken = $modal.find('.git-access-token').val();
    if (accessToken && username) {
      setLocalStorageItem('git-username', username);
      setLocalStorageItem('git-access-token', accessToken);
      hideModal($modal);
      createGitFSWorker();
    }
  });
}

Menubar.connectRepo = () => {
  const repoLink = getLocalStorageItem('connected-repo', '');

  const localFilesNotice = repoLink ? '' :
    `
    <p class="text-small">
      ❗️ Local files will be permanently discarded when connecting a new repository.
      If you want to keep your local files, please download them manually before continuing.
    </p>
    `;

  const $modal = createModal({
    title: 'Connect repository',
    body: `
      <p>Only GitHub repostory links are supported. Leave empty to disconnect from the repository.</p>
      <input class="text-input full-width-input repo-link" value="${repoLink}" placeholder="Fill in a repository link"></textarea>
      ${localFilesNotice}
    `,
    footer: `
      <button type="button" class="button cancel-btn">Cancel</button>
      <button type="button" class="button primary-btn confirm-btn">Connect</button>
    `,
    attrs: {
      id: 'ide-connect-repo-modal',
      class: 'modal-width-small',
    }
  });

  showModal($modal);

  $modal.find('.cancel-btn').click(() => hideModal($modal));
  $modal.find('.confirm-btn').click(() => {
    const repoLink = $modal.find('.repo-link').val();

    // For now, we only allow GitHub repo links.
    if (repoLink && !/^https:\/\/github.com\/[\w-]+\/[\w-]+(?:\.git)?/.test(repoLink)) {
      alert('Invalid GitHub repository');
      return;
    }

    if (repoLink) {
      setLocalStorageItem('connected-repo', repoLink);
    } else {
      removeLocalStorageItem('connected-repo');
    }

    hideModal($modal);
    createGitFSWorker();
  });
}
