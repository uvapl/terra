///////////////////////////////////////////////////////////////////////////////
// Menubar interaction for the IDE app.
//
// The menu is built dynamically in commands.js. This file wires the open/close
// interactions. Uses delegated handlers so it works regardless of whether the
// menu is already created, and is idempotent (namespaced off-then-on) so it
// can be called again safely.
///////////////////////////////////////////////////////////////////////////////
import Terra from "../terra.js";

export function initMenubar() {
  // Open a top-level menu when its label is clicked.
  $(document)
    .off("click.menubar")
    .on("click.menubar", ".menubar > li", function (event) {
      if ($(event.target).parent().hasClass("menubar")) {
        $(this).toggleClass("open").siblings().removeClass("open");
      }
    });

  // Close the open menu when clicking outside of it.
  $(document)
    .off("click.menubarOutside")
    .on("click.menubarOutside", (event) => {
      // When menu is open, and click is outside the menu:
      if ($(".menubar > li.open").length && !$(event.target).closest(".menubar").length) {
        closeActiveMenuBarMenu(event);
      }
    });

  // Close the open menu when pressing ESC.
  $(document)
    .off("keydown.menubar")
    .on("keydown.menubar", (event) => {
      if (event.key === "Escape") {
        closeActiveMenuBarMenu(event);
      }
    });

  // Close the open menu after clicking one of its items.
  $(document)
    .off("click.menubarItem")
    .on("click.menubarItem", ".menubar > li li", (event) => {
      closeActiveMenuBarMenu(event);
    });
}

function closeActiveMenuBarMenu(event) {
  const isInsideMenu = $(".menubar > li.open").find($(event.target)).length > 0;
  const isNotNewFileOrFolderBtn = !$(event.target).is(
    "#menu-item--new-file, #menu-item--new-folder",
  );
  const itemEnabled = !$(".menubar > li.open").find($(event.target)).hasClass("disabled");

  // Focus the active editor tab, except for making new files/folders.
  if (!isInsideMenu || (isInsideMenu && isNotNewFileOrFolderBtn && itemEnabled)) {
    Terra.app.focusActiveEditor();
  }

  // Close the active menu; but only when it is not a disabled menu item.
  if (!isInsideMenu || itemEnabled) {
    $(".menubar > li.open").removeClass("open");
  }
}
