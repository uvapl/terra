////////////////////////////////////////////////////////////////////////////////
// Cross-stack drag constraint for GoldenLayout.
//
// For this application, we keep editor tabs in a separate stack from terminal
// and canvas output tabs.
//
// To make GoldenLayout work with this restriction, we change the internally
// reported drop area to be none when dragging over the wrong part. To know
// what is where, stacks are tagged as having a `_terraArea`: 'editor' or
// 'output'.
//
// Tagging of areas is done in the layout.flexible class.
//
// We probably could have used two separate GoldenLayouts to get the same
// effect, but: this way we can serialize the full layout at once.
//
// The exported function constrainDrops() below is called by the layout to
// activate the hook.
////////////////////////////////////////////////////////////////////////////////

import { isEditorItem } from './tab-config.js';

/**
 * Decide whether dropping `dragged` into `targetStack` is allowed based on
 * the item's tag.
 *
 * Note: untagged targets (e.g. the root container) are rejected everywhere,
 * so this does not lead to creating new top-level areas.
 *
 * @param {ComponentItem} dragged - the tab being dragged
 * @param {ContentItem} targetStack - the stack under the cursor
 * @returns {boolean}
 */
function isDropAllowed(dragged, targetStack) {
  const area = targetStack?._terraArea;
  return isEditorItem(dragged) ? area === 'editor' : area === 'output';
}

/**
 * Check whether a dragged item is still attached to a real parent. When
 * dragging the last tab in a stack, the stack will be deleted; so we use this
 * function to check whether we might need to create a new parent.
 *
 * @param {ContentItem} item - the item to check
 * @param {Layout} layout - the layout that owns the tree
 * @returns {boolean}
 */
function isAttached(item, layout) {
  for (let node = item; node; node = node.parent) {
    if (node === layout.root) return true;

    // the key is to check whether a stated parent itself also reports
    // having the item as child
    if (!node.parent?.contentItems.includes(node)) return false;
  }
  return false;
}

/**
 * Install the drag constraint on a layout by wrapping two of its public
 * LayoutManager methods:
 *
 *  - startComponentDrag() saves a reference to the item when dragging starts
 *    and clears it when dragging is stopped
 *  - getArea() is where we return null to disallow dropping when dragging
 *    over the wrong area (GoldenLayout itself neatly follows by only
 *    drop-highlighting areas where we do not intervene)
 *
 * @param {Layout} layout - The layout instance to constrain.
 */
export function constrainDrops(layout) {
  const startComponentDrag = layout.startComponentDrag.bind(layout);
  const getArea = layout.getArea.bind(layout);

  layout.startComponentDrag = (x, y, dragListener, componentItem, stack) => {
    layout._terraDragged = componentItem;

    const result = startComponentDrag(x, y, dragListener, componentItem, stack);

    // Subscribed after the DragProxy's own 'dragStop' handler so this runs once
    // its drop is done, not before it.
    dragListener.on('dragStop', () => { layout._terraDragged = null; });

    return result;
  };

  layout.getArea = (x, y) => {
    const area = getArea(x, y);
    if (area === null) return null;
    return isDropAllowed(layout._terraDragged, area.contentItem) ? area : null;
  };

  // If a drop is effected outside allowed areas, this makes sure that the
  // layout is asked to provide a "new home".
  layout.on('itemDropped', (componentItem) => {
    if (isAttached(componentItem, layout)) return;

    const home = layout.ensureDropHome?.(componentItem, null);
    if (!home) return;

    // note: no need to manually remove the item from its previous parent
    home.addChild(componentItem);
  });
}
