////////////////////////////////////////////////////////////////////////////////
// Cross-stack drag constraint for GoldenLayout 1.5.9.
//
// Editors live only in the editor stack; the terminal, canvas and image tabs
// live only in the output stack. GoldenLayout has no native way to restrict
// where a tab may be dropped, so this module patches the drag machinery to
// reject illegal cross-stack drops: an illegal target is never highlighted nor
// remembered as a valid drop area, so the tab can only land in a legal stack
// (and falls back to its origin otherwise).
//
// Everything is contained here and gated behind a single flag so it can be
// disabled in one place: set `Layout.constrainDrag = false` (or simply don't
// call applyDragConstraints) to restore GoldenLayout's default free dragging.
//
// The rule is keyed on a `_terraArea` marker the layout stamps onto every stack
// ('editor' or 'output'). This survives splitting either area into several
// stacks (where GoldenLayout ids do not), and rejecting drops onto untagged
// containers (e.g. the root row/column) prevents new top-level areas.
////////////////////////////////////////////////////////////////////////////////

/**
 * Whether the given GoldenLayout content item is an editor component.
 *
 * @param {GoldenLayout.ContentItem} item
 * @returns {boolean}
 */
function isEditorItem(item) {
  return item?.config?.componentName === 'editor';
}

/**
 * Decide whether dropping `dragged` into `targetStack` is allowed: an editor may
 * only land in a stack tagged as the editor area; any other tab only in a stack
 * tagged as the output area. Untagged targets (e.g. the root container) are
 * rejected so a drop can never create a new top-level area.
 *
 * @param {GoldenLayout.ContentItem} dragged - The tab being dragged.
 * @param {GoldenLayout.ContentItem} targetStack - The stack under the cursor.
 * @returns {boolean}
 */
function isDropAllowed(dragged, targetStack) {
  const area = targetStack?._terraArea;
  return isEditorItem(dragged) ? area === 'editor' : area === 'output';
}

/**
 * Install the cross-stack drag constraint by wrapping GoldenLayout's internal
 * DragProxy. Idempotent: a guard flag on the patched prototype prevents
 * double-wrapping across multiple layout instances (e.g. after an orientation
 * switch, which rebuilds the layout).
 *
 * @param {Function} GoldenLayout - The global GoldenLayout constructor.
 */
export function applyDragConstraints(GoldenLayout) {
  const proto = GoldenLayout.__lm?.controls?.DragProxy?.prototype;
  if (!proto || !proto._setDropPosition) {
    console.warn('applyDragConstraints: GoldenLayout internals unavailable; skipping.');
    return;
  }

  if (proto._terraDragConstrained) return;
  proto._terraDragConstrained = true;

  // Reimplements GoldenLayout's _setDropPosition (which computes the drop area,
  // remembers it as the last valid area, and highlights it) with one extra gate:
  // an area whose stack is an illegal target for the dragged item is treated as
  // no area at all — not highlighted, not recorded — so the tab can never be
  // dropped across the editor/output boundary.
  proto._setDropPosition = function (x, y) {
    this.element.css({ left: x, top: y });
    this._area = this._layoutManager._$getArea(x, y);

    if (this._area !== null && isDropAllowed(this._contentItem, this._area.contentItem)) {
      this._lastValidArea = this._area;
      this._area.contentItem._$highlightDropZone(x, y, this._area);
    } else {
      this._area = null;
    }
  };

  // Safety net: when a tab is dropped with no valid target (e.g. dragged out of
  // its area and released in dead space), GoldenLayout reverts to the tab's
  // original stack — but GL removes that stack at drag start when it empties
  // (closable stacks), so the revert would re-add to a detached stack and the
  // tab would be lost. Re-home it to a live stack of its kind instead. Only the
  // both-areas-null case is touched; legal drops are untouched.
  const originalOnDrop = proto._onDrop;
  proto._onDrop = function () {
    if (this._area === null && this._lastValidArea === null) {
      const home = this._layoutManager?.ensureDropHome?.(this._contentItem, this._originalParent);
      if (home) this._originalParent = home;
    }
    return originalOnDrop.apply(this, arguments);
  };
}
