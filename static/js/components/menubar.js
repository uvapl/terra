///////////////////////////////////////////////////////////////////////////////
// Menubar interaction for the IDE app.
//
// The menu is built dynamically in commands.js. This file wires the open/close
// interactions. Uses delegated handlers so it works regardless of whether the
// menu is already created, and is idempotent (remove-then-add) so it can be
// called again safely.
///////////////////////////////////////////////////////////////////////////////
import Terra from "../terra.js";

export function initMenubar() {
  document.removeEventListener("click", handleMenubarClick);
  document.removeEventListener("keydown", handleMenubarKeydown);
  document.removeEventListener("contextmenu", handleMenubarContextmenu, true);

  document.addEventListener("click", handleMenubarClick);
  document.addEventListener("keydown", handleMenubarKeydown);
  document.addEventListener("contextmenu", handleMenubarContextmenu, true);
}

function handleMenubarClick(event) {
  const target = event.target;

  // 1. Open a top-level menu when its label is clicked.
  const topLevelItem = target.closest(".menubar > li");
  if (topLevelItem && target.parentElement.classList.contains("menubar")) {
    const isOpen = topLevelItem.classList.contains("open");
    topLevelItem.parentElement
      .querySelectorAll(".menubar > li.open")
      .forEach((sibling) => sibling.classList.remove("open"));
    topLevelItem.classList.toggle("open", !isOpen);
    return;
  }

  // 2. Close the open menu after clicking one of its items.
  if (target.closest(".menubar > li li")) {
    closeActiveMenuBarMenu(event);
    return;
  }

  // 3. Close the open menu when clicking outside of it.
  const openMenu = document.querySelector(".menubar > li.open");
  if (openMenu && !target.closest(".menubar")) {
    closeActiveMenuBarMenu(event);
  }
}

function handleMenubarContextmenu(event) {
  const openMenu = document.querySelector(".menubar > li.open");
  if (openMenu && !event.target.closest(".menubar")) {
    closeActiveMenuBarMenu(event);
  }
}

function handleMenubarKeydown(event) {
  if (event.key === "Escape") {
    closeActiveMenuBarMenu(event);
  }
}

function closeActiveMenuBarMenu(event) {
  const openMenu = document.querySelector(".menubar > li.open");
  const target = event.target;

  const isInsideMenu = !!(openMenu && openMenu.contains(target));
  const isNotNewFileOrFolderBtn = !target.matches(
    "#menu-item--new-file, #menu-item--new-folder",
  );
  const itemEnabled = !!(
    openMenu &&
    openMenu.contains(target) &&
    !target.classList.contains("disabled")
  );

  // Focus the active editor tab, except for making new files/folders.
  if (!isInsideMenu || (isInsideMenu && isNotNewFileOrFolderBtn && itemEnabled)) {
    Terra.app.focusActiveEditor();
  }

  // Close the active menu; but only when it is not a disabled menu item.
  if (!isInsideMenu || itemEnabled) {
    if (openMenu) openMenu.classList.remove("open");
  }
}
