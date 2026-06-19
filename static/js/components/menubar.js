////////////////////////////////////////////////////////////////////////////////
// Menubar interaction for the IDE app.
//
// The menu *structure* is built dynamically by commands.buildMenu() from the
// registry (see app.ide.commands.js), and the menu *actions* live with their
// respective concerns (the app, the LFS/Git concerns, etc.). This file only
// owns the open/close interaction for the dynamically built menu.
////////////////////////////////////////////////////////////////////////////////
import Terra from '../terra.js';

/**
 * Wire up open/close behaviour for the (dynamically built) menubar. Uses
 * delegated handlers so it works regardless of when commands.buildMenu() ran,
 * and is idempotent (namespaced off-then-on) so it can be called again safely.
 */
export function initMenubar() {
  // Toggle a top-level menu open when its label is clicked.
  $(document).off('click.menubar').on('click.menubar', '.menubar > li', function (event) {
    if ($(event.target).parent().hasClass('menubar')) {
      $(this).toggleClass('open').siblings().removeClass('open');
    }
  });

  // Close the open menu when clicking outside of it.
  $(document).off('click.menubarOutside').on('click.menubarOutside', (event) => {
    if (!$(event.target).closest('.menubar').length) {
      closeActiveMenuBarMenu(event);
    }
  });

  // Close the open menu when pressing ESC.
  $(document).off('keydown.menubar').on('keydown.menubar', (event) => {
    if (event.key === 'Escape') {
      closeActiveMenuBarMenu(event);
    }
  });

  // Close the open menu after clicking one of its items.
  $(document).off('click.menubarItem').on('click.menubarItem', '.menubar > li li', (event) => {
    closeActiveMenuBarMenu(event);
  });
}

function closeActiveMenuBarMenu(event) {
  // Focus the active editor tab, except for making new files/folders.
  const isInsideMenu = $('.menubar > li.open').find($(event.target)).length > 0;
  const isNotNewFileOrFolderBtn = !$(event.target).is('#menu-item--new-file, #menu-item--new-folder');
  const editorComponent = Terra.app.getActiveEditor();
  if (isInsideMenu && isNotNewFileOrFolderBtn && editorComponent && editorComponent.ready) {
    // Suspend reactive reloads to prevent file contents being reloaded
    Terra.app.suspendFSReload();
    editorComponent.focus();
    Terra.app.resumeFSReload();
  }

  // Close the active menu only when it is not a disabled menu item.
  if (!$('.menubar > li.open').find($(event.target)).hasClass('disabled')) {
    $('.menubar > li.open').removeClass('open');
  }
}
