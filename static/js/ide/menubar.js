////////////////////////////////////////////////////////////////////////////////
// This file contains the logic for the menubar at the top of the IDE app.
////////////////////////////////////////////////////////////////////////////////
import { isMac } from '../helpers/shared.js';
import { createModal, hideModal, showModal } from '../modal.js';
import Terra from '../terra.js';
import localStorageManager from '../local-storage-manager.js';
import fileTreeManager from '../file-tree-manager.js';
import { GITHUB_URL_PATTERN } from './constants.js';
import * as LFS from '../fs/lfs.js';

$(document).ready(() => {
  $('.menubar [data-keystroke]').each((_, element) => setMenubarKeystrokeIcons(element));
  registerMenubarEventListeners();

  // Disable the connect repo button if no credentials are set yet.
  const gitToken = localStorageManager.getLocalStorageItem('git-access-token');
  if (!gitToken) {
    $('#menu-item--connect-repo').addClass('disabled');
  }
});

// ===========================================================================
// Functions
// ===========================================================================

export function renderGitRepoBranches(branches) {
  $('#menu-item--branch').addClass('has-dropdown');
  $('#menu-item--branch ul').remove();

  const branchesHtml = branches.map(branch => {
    if (branch.current) {
      return `<li class="active" data-val="${branch.name}">${branch.name}</li>`;
    } else {
      return `<li data-val="${branch.name}">${branch.name}</li>`;
    }
  }).join('');

  $('#menu-item--branch').append(`<ul id="git-branches">${branchesHtml}</ul>`);
  $('#menu-item--branch').removeClass('disabled');

  $('#git-branches').find('li').click((event) => {
    const $element = $(event.target);
    if ($element.hasClass('active')) return;

    const newBranch = $element.data('val');
    localStorageManager.setLocalStorageItem('git-branch', newBranch);
    $element.addClass('active').siblings().removeClass('active');

    Terra.app.gitfs.setRepoBranch(newBranch);

    fileTreeManager.setInfoMsg('Cloning repository...');
    Terra.app.gitfs.clone();

    Terra.app.closeAllFiles();
  });
}

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

function closeActiveMenuBarMenu(event) {
  // Focus the active editor tab, except for making new files/folders.
  // Check if the event.target has neither the id menu-item--new-file and
  // and menu-item--new-folder.
  const isInsideMenu = $('.menubar > li.open').find($(event.target)).length > 0;
  const isNotNewFileOrFolderBtn = !$(event.target).is('#menu-item--new-file, #menu-item--new-folder');
  const editorComponent = Terra.app.getActiveEditor();
  if (isInsideMenu && isNotNewFileOrFolderBtn && editorComponent && editorComponent.ready) {
    // Set Terra.v.blockFSPolling to prevent file contents being reloaded
    Terra.v.blockFSPolling = true;
    editorComponent.focus();
    Terra.v.blockFSPolling = false;
  }

  // Close the active menu only when it is not a disabled menu item.
  if (!$('.menubar > li.open').find($(event.target)).hasClass('disabled')) {
    $('.menubar > li.open').removeClass('open');
  }
}

// Open the first menu level when clicking the main menubar items.
$('.menubar > li').click((event) => {
  // Check if the clicked item is one of the menubar children.
  const $listItem = $(event.target);
  if ($listItem.parent().hasClass('menubar')) {
    $listItem.toggleClass('open').siblings().removeClass('open');
  }
});


/**
 * Registers onclick handlers for all actions in the menubar as well as global
 * keyboard shortcuts in the document.
 */
function registerMenubarEventListeners() {
  // Main menu items.
  // ================

  // Close menu when clicking outside of it.
  $(document).click((event) => {
    if (!$(event.target).closest('.menubar').length) {
      closeActiveMenuBarMenu(event);
    }
  });

  // Close menu when pressing ESC.
  $(document).keydown((event) => {
    if (event.key === 'Escape') {
      closeActiveMenuBarMenu(event);
    }
  });

  // Close menu when clicking on a menu item.
  $('.menubar > li li').click((event) => {
    closeActiveMenuBarMenu(event);
  });

  // All submenu item event listeners.
  // =================================
  $('#menu-item--new-file').click(() => fileTreeManager.createFile());
  Mousetrap.bind(['ctrl+t'], () => fileTreeManager.createFile());

  $('#menu-item--new-folder').click(() => fileTreeManager.createFolder());
  Mousetrap.bind(['ctrl+shift+t'], () => fileTreeManager.createFolder());

  $('#menu-item--close-file').click(() => Terra.app.closeFile());
  Mousetrap.bind(['ctrl+w'], () => Terra.app.closeFile());

  $('#menu-item--comment').click(Menubar.toggleComment);

  $('#menu-item--close-project').click(Menubar.closeLFSFolder);
  $('#menu-item--open-folder').click(Menubar.openLFSFolder);
  Mousetrap.bind(['ctrl+shift+o'], Menubar.openLFSFolder);

  $('#menu-item--undo').click(Menubar.undo);
  $('#menu-item--redo').click(Menubar.redo);

  $('#menu-item--copy').click(Menubar.copyToClipboard);
  $('#menu-item--cut').click(Menubar.cut);
  $('#menu-item--paste').click(Menubar.pasteFromClipboard);

  $('#menu-item--move-lines-up').click(Menubar.moveLinesUp);
  $('#menu-item--move-lines-down').click(Menubar.moveLinesDown);

  $('#menu-item--indent').click(Menubar.indent);
  $('#menu-item--outdent').click(Menubar.outdent);

  $('#menu-item--find-next').click(Menubar.findNext);
  $('#menu-item--find-previous').click(Menubar.findPrev);

  $('#menu-item--search').click(Menubar.search);
  Mousetrap.bind(['ctrl+f', 'meta+f'], Menubar.search);

  $('#menu-item--replace').click(Menubar.replace);

  $('#menu-item--run-tab').click(Menubar.runTab);

  $('#menu-item--add-credentials').click(Menubar.addCredentials);
  $('#menu-item--connect-repo').click(Menubar.connectRepo);

  $('#menu-item--reset-layout').click(() => Terra.app.resetLayout());

  $('#menu-item--kill-process').click(Menubar.killTermProcess);
  $('#menu-item--clear-term').click(() => Terra.app.termClear());

  // Prevent the default browser save dialog when pressing ctrl+s or cmd+s.
  Mousetrap.bind(['ctrl+s', 'meta+s'], (event) => event.preventDefault());
}

const Menubar = {};

Menubar.openNewFile = () => {
  fileTreeManager.createFile();
};

Menubar.openLFSFolder = () => {
  if (!LFS.available()) return;

  Terra.app.openLFSFolder().then(() => {
    fileTreeManager.removeInfoMsg();
    $('#menu-item--close-project').removeClass('disabled');
  });
};

Menubar.closeLFSFolder = (event) => {
  if ($('#menu-item--close-project').hasClass('disabled')) return;

  // Close the connected Git(Hub) repo, if any.
  localStorageManager.removeLocalStorageItem('git-repo');
  Terra.app.closeGitFS();

  // Close the LFS folder, if any.
  Terra.app.closeLFSFolder();

  $('#menu-item--close-project').addClass('disabled');
  closeActiveMenuBarMenu(event);
};

Menubar.undo = () => {
  Terra.app.getActiveEditor().editor.undo();
};

Menubar.redo = () => {
  Terra.app.getActiveEditor().editor.redo();
};

Menubar.copyToClipboard = () => {
  const editor = Terra.app.getActiveEditor().editor;
  if (!editor.selection.isEmpty()) {
    const text = editor.getSelectedText();
    navigator.clipboard.writeText(text);
  }
};

Menubar.cut = () => {
  Menubar.copyToClipboard();

  // Cut the selected text.
  Terra.app.getActiveEditor().editor.insert('');
};

Menubar.toggleComment = () => {
  Terra.app.getActiveEditor().editor.toggleCommentLines();
}

Menubar.moveLinesUp = () => {
  Terra.app.getActiveEditor().editor.moveLinesUp();
}

Menubar.moveLinesDown = () => {
  Terra.app.getActiveEditor().editor.moveLinesDown();
}

Menubar.pasteFromClipboard = () => {
  navigator.clipboard.readText().then((text) => {
    Terra.app.getActiveEditor().editor.insert(text);
  });
};

Menubar.indent = () => {
  Terra.app.getActiveEditor().editor.blockIndent();
};

Menubar.outdent = () => {
  Terra.app.getActiveEditor().editor.blockOutdent();
};

Menubar.findNext = () => {
  Terra.app.getActiveEditor().editor.findNext();
}

Menubar.findPrev = () => {
  Terra.app.getActiveEditor().editor.findPrevious();
}

Menubar.search = () => {
  Terra.app.getActiveEditor().editor.execCommand('find');
};

Menubar.replace = () => {
  Terra.app.getActiveEditor().editor.execCommand('replace');
};

Menubar.runTab = () => {
  Terra.app.getActiveEditor().editor.execCommand('run');
};

Menubar.connectRepo = () => {
  if ($('#menu-item--connect-repo').hasClass('disabled')) return;

  const accessToken = localStorageManager.getLocalStorageItem('git-access-token', '');

  // When the current repo link exists, the user was already connected and they
  // want to connect to another repository.
  const currentRepoLink = localStorageManager.getLocalStorageItem('git-repo', '');

  const hasEmptyFields = !accessToken || !currentRepoLink;

  const $connectModal = createModal({
    title: 'Connect repository',
    body: `
      <div class="form-wrapper-full-width">
        <label>Personal access token:</label>
        <input type="password" class="text-input full-width-input git-access-token" value="${accessToken}" placeholder="Fill in your personal access token" />
      </div>

      <p class="text-small">
        GitHub access tokens can be created <a href="https://github.com/settings/tokens">here</a>.
        Make sure to at least check the <em>repo</em> scope such that all its subscopes are checked.
        <br\>
        <br\>
        In order to clone private repositories or push and pull contents from any repository, your GitHub personal access token is required.
        Credentials will be stored locally in your browser and will not be shared with anyone.
      </p>

      <div class="form-wrapper-full-width">
        <label>Repository HTTPS URL</label>
        <input class="text-input full-width-input repo-link" value="${currentRepoLink}" placeholder="https://github.com/{owner}/{repo}"></textarea>
      </div>
    `,
    footer: `
      <button type="button" class="button cancel-btn">Cancel</button>
      <button type="button" class="button primary-btn connect-btn" ${hasEmptyFields ? 'disabled' : ''}>Connect</button>
    `,
    attrs: {
      id: 'ide-connect-repo-modal',
      class: 'modal-width-small',
    }
  });

  showModal($connectModal).then(() => {
    $('#ide-connect-repo-modal .repo-link').focus();
  });

  // Disable the connect button when any of the text fields are empty.
  $connectModal.find('.text-input').on('keyup', () => {
    const hasEmptyFields = $connectModal.find('.text-input').toArray().some(input => !$(input).val().trim());
    const $connectBtn = $connectModal.find('.connect-btn');

    if (hasEmptyFields) {
      $connectBtn.attr('disabled', 'disabled');
    } else {
      $connectBtn.removeAttr('disabled');
    }
  });

  $connectModal.find('.cancel-btn').click(() => hideModal($connectModal));
  $connectModal.find('.connect-btn').click(() => {
    // For now, we only allow GitHub-HTTPS repo links.
    const newRepoLink = $connectModal.find('.repo-link').val().trim();
    if (newRepoLink && !GITHUB_URL_PATTERN.test(newRepoLink)) {
      alert('Invalid GitHub repository');
      return;
    }

    const newAccessToken = $connectModal.find('.git-access-token').val();
    localStorageManager.setLocalStorageItem('git-access-token', newAccessToken);

    hideModal($connectModal);

    // Remove previously selected branch such that the clone will use the
    // default branch for the new repo.
    localStorageManager.removeLocalStorageItem('git-branch');

    console.log('Connecting to repository:', newRepoLink);
    localStorageManager.setLocalStorageItem('git-repo', newRepoLink);
    Terra.app.openGitFS();
  });
};

Menubar.killTermProcess = () => {
  const event = { key: 'c', ctrlKey: true };
  Terra.app.handleControlC(event);
}
