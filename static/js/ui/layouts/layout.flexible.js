import Layout from './layout.js';
import ImageTab from '../components/image.tab.js';
import CanvasTab from '../components/canvas.tab.js';

/**
 * A Layout the user can restructure at runtime: flip the orientation
 * (horizontal ⇄ vertical) and split/merge the output tabs into separate stacks,
 * plus all the bookkeeping those features need (area tagging, editor-stack
 * closability, the drag safety net, and the split/merge toggle control).
 *
 * The base Layout owns only the *initial* orientation and the read-only area
 * helpers; everything that mutates the structure after load lives here. Only the
 * IDE extends this — the lab/exam/embed variants have a fixed two-pane layout
 * (no tab reordering, no second output tab), so they stay on the plain base.
 */
export default class FlexibleLayout extends Layout {
  /**
   * Switch the layout orientation at runtime, in place and without recreating any
   * component (editors keep their undo history, the terminal its scrollback and
   * worker). Builds a fresh root container of the opposite axis and *relocates*
   * the live stacks into it — the same reparent-don't-recreate idiom as
   * arrangeOutput(). When the output area is split, its container is rebuilt
   * perpendicular to the new main axis (row when vertical, column when
   * horizontal). A no-op when already in the requested orientation.
   *
   * @param {string} orientation - 'horizontal' | 'vertical'.
   */
  setOrientation(orientation) {
    if (orientation !== 'horizontal' && orientation !== 'vertical') return;
    if (this._orientation === orientation) return;

    const oldMain = this.getMainContainer();
    if (!oldMain) { this._orientation = orientation; return; }

    const mainType = orientation === 'vertical' ? 'column' : 'row';
    // Split output stays perpendicular to the main axis.
    const outputType = orientation === 'vertical' ? 'row' : 'column';

    // Snapshot the live top-level children before any reparenting.
    const children = [...oldMain.contentItems];

    // Identify the output sub-tree (the one main child whose subtree holds output
    // components) so only it is rebuilt perpendicular; editor stacks move as-is.
    const isOutput = (item) => item.isComponent
      ? item.config.componentName !== 'editor'
      : (item.contentItems || []).some(isOutput);

    // Empty container of the new axis, swapped into the root in place of oldMain.
    // No 3rd arg => oldMain (still holding the live stacks) is detached from the
    // DOM but NOT destroyed, so its stacks survive for relocation. It is left
    // unreferenced afterwards (destroying it would destroy the moved stacks) and
    // is garbage-collected.
    const newMain = this.createContentItem(
      { type: mainType, content: [], isClosable: false }, this.root
    );
    this.root.replaceChild(oldMain, newMain);

    // Relocate each live top-level item into newMain (moving DOM, not recreating).
    for (const child of children) {
      if (!child.isStack && isOutput(child)) {
        // Split output: rebuild perpendicular and move its stacks across.
        const perp = this.createContentItem(
          { type: outputType, content: [], id: child.config.id }, newMain
        );
        newMain.addChild(perp);
        [...child.contentItems].forEach((stack) => perp.addChild(stack));
      } else {
        newMain.addChild(child); // editor stack(s) / single output stack
      }
    }

    this._orientation = orientation;
    this._afterOrientationChanged();
  }

  /**
   * Re-apply the orientation-dependent side effects after an in-place flip —
   * those the destroy/recreate path used to get for free, minus anything that
   * touches components. Updates the View ▸ Orientation menu state, re-tags the
   * areas and re-renders the output split/merge toggle (its icon depends on
   * orientation), and relays out so Ace/xterm recompute against the new geometry.
   */
  _afterOrientationChanged() {
    $('#menu-item--orientation-horizontal').toggleClass('active', !this.vertical);
    $('#menu-item--orientation-vertical').toggleClass('active', this.vertical);

    this._scheduleOutputControlsRefresh();
    this.refresh();
  }

  /**
   * Wire up the runtime-restructuring controls once the layout is initialised:
   * tag the stacks, render the split/merge toggle, and keep both in sync with any
   * structural change (tab add/remove/move, manual split/merge via drag).
   * Overrides the base no-op hook.
   */
  _initStructureControls() {
    this._tagAreas();
    if (this.renderOutputArrangeControls()) {
      const { sig, firstEl } = this._outputSignature();
      this._outputSig = sig;
      this._outputFirstEl = firstEl;
    }

    this.on('stateChanged', () => this._scheduleOutputControlsRefresh());
  }

  /**
   * The output stack the split/merge toggle is anchored to. The toggle lives in
   * a stack header's top-right controls, so it should sit in the corner of the
   * whole output area: the first (topmost) stack when the split output is stacked
   * vertically (horizontal main layout → output column), but the last (rightmost)
   * stack when it is laid out horizontally (vertical main layout → output row).
   *
   * @returns {?GoldenLayout.Stack}
   */
  _anchorOutputStack() {
    const outputStacks = this._allStacks().filter((stack) => this._isOutputStack(stack));
    if (outputStacks.length === 0) return null;
    return this.vertical ? outputStacks[outputStacks.length - 1] : outputStacks[0];
  }

  /**
   * Stamp every stack with a `_terraArea` marker ('editor' | 'output') based on
   * its content, so the drag constraint can tell which area a drop target
   * belongs to regardless of how the tree is split or flattened. Empty stacks
   * (transient mid-drag) keep their previous tag.
   */
  _tagAreas() {
    this._allStacks().forEach((stack) => {
      if (this._isEditorStack(stack)) stack._terraArea = 'editor';
      else if (stack.contentItems.length > 0) stack._terraArea = 'output';
    });
  }

  /**
   * Editor stacks must be closable for GoldenLayout to auto-remove one that is
   * emptied — e.g. closing the last file in a split-off stack should merge the
   * split back. But the *sole* editor stack must stay non-closable so the editor
   * area can never collapse to nothing (onTabDestroy already guarantees an
   * Untitled in that single-stack case). So: closable iff editors span >1 stack.
   */
  _syncEditorStacksClosable() {
    const editorStacks = this._allStacks().filter((stack) => this._isEditorStack(stack));
    const closable = editorStacks.length > 1;
    editorStacks.forEach((stack) => { stack.config.isClosable = closable; });
  }

  /** @returns {boolean} Whether the output tabs are spread across multiple stacks. */
  isOutputSplit() {
    return this._allStacks().filter((stack) => this._isOutputStack(stack)).length > 1;
  }

  /**
   * Resolve a live stack to drop a dragged tab into when it was released with no
   * valid target (the drag constraint's safety net). Returns null to leave
   * GoldenLayout's normal revert in place when the tab's original stack is still
   * alive; otherwise returns a stack of the tab's kind (creating a fresh one in
   * the main container if its area was emptied and removed mid-drag), so the tab
   * is never lost.
   *
   * @param {GoldenLayout.ContentItem} contentItem - The dragged tab.
   * @param {?GoldenLayout.Stack} originalParent - The tab's stack at drag start.
   * @returns {?GoldenLayout.Stack}
   */
  ensureDropHome(contentItem, originalParent) {
    const stacks = this._allStacks();

    // Original stack still in the tree: let GoldenLayout revert there as usual.
    if (originalParent && stacks.includes(originalParent)) return null;

    const isEditor = contentItem?.config?.componentName === 'editor';
    const home = stacks.find((stack) => isEditor ? this._isEditorStack(stack) : this._isOutputStack(stack));
    if (home) return home;

    // No stack of this kind remains: add a fresh non-closable stack to the main
    // container (editors first, output last) for the tab to land in.
    const main = this.getMainContainer();
    if (!main) return null;

    const index = isEditor ? 0 : main.contentItems.length;
    main.addChild({ type: 'stack', isClosable: false }, index);
    return main.contentItems[index] ?? null;
  }

  /**
   * Rearrange the output tabs, leaving the editor stacks untouched. 'stacked'
   * collapses the output tabs into one stack; 'split' gives each its own stack
   * laid out perpendicular to the main orientation (a row when the layout is
   * vertical, a column when horizontal — perpendicular nesting survives
   * GoldenLayout's same-axis flattening).
   *
   * Mutates only the output subtree in place: the live output components
   * (terminal/canvas/image) are *relocated* between stacks, never recreated, so
   * the terminal keeps its scrollback and worker connection and — crucially —
   * the editors are never reloaded. This relies on GoldenLayout's
   * `Stack.addChild(liveItem)` reparenting the item's DOM element, the same
   * mechanism its drag-and-drop uses; `removeChild(item, true)` detaches without
   * destroying.
   *
   * @param {string} mode - 'stacked' | 'split'.
   */
  arrangeOutput(mode) {
    const main = this.getMainContainer();
    if (!main) return;

    // The output area is the single main child whose subtree holds output tabs
    // (editors and output never share a stack, and the output is always
    // consolidated into one child). Collect its live components in visual order.
    const isOutput = (item) => item.isComponent
      ? item.config.componentName !== 'editor'
      : (item.contentItems || []).some(isOutput);
    const oldContainer = main.contentItems.find(isOutput);
    if (!oldContainer) return;

    const comps = [];
    const walk = (item) => {
      if (item.isComponent) comps.push(item);
      else (item.contentItems || []).forEach(walk);
    };
    walk(oldContainer);
    if (comps.length === 0) return;

    const split = mode === 'split' && comps.length > 1;
    if (split === this.isOutputSplit()) return; // already in the requested arrangement

    // Build the new (empty) output container appended after the old one; removing
    // the old one afterwards leaves it last (editors stay first).
    main.addChild(
      split
        ? { type: this.vertical ? 'row' : 'column', id: 'outputStack' }
        : { type: 'stack', id: 'outputStack', isClosable: false },
      main.contentItems.length
    );
    const newContainer = main.contentItems[main.contentItems.length - 1];

    // Relocate (not recreate) each live component into the new structure. Split
    // gives each its own stack; stacked drops them all into the one stack.
    const relocate = (stack, comp) => {
      comp.parent.removeChild(comp, true);
      stack.addChild(comp);
    };
    if (split) {
      comps.forEach((comp) => {
        newContainer.addChild({ type: 'stack' });
        relocate(newContainer.contentItems[newContainer.contentItems.length - 1], comp);
      });
    } else {
      comps.forEach((comp) => relocate(newContainer, comp));
    }

    // Drop the emptied old container. A non-closable stack won't self-remove when
    // emptied (closable split stacks already did), so remove it explicitly if it
    // is still attached.
    if (main.contentItems.indexOf(oldContainer) !== -1) {
      main.removeChild(oldContainer);
    }

    this.outputStack = newContainer.isStack ? newContainer : newContainer.contentItems[0];
    this._scheduleOutputControlsRefresh();
  }

  /**
   * Re-tag the areas and, when the output structure actually changed, re-render
   * the output controls. Coalesced to once per tick so bursts of GoldenLayout
   * `stateChanged` events (e.g. typing, or dragging a splitter) collapse to one
   * pass — and the signature guard skips the DOM work entirely when only
   * content changed.
   */
  _scheduleOutputControlsRefresh() {
    if (this._outputRefreshScheduled) return;
    this._outputRefreshScheduled = true;
    setTimeout(() => {
      this._outputRefreshScheduled = false;
      this._tagAreas();
      this._syncEditorStacksClosable();

      const { sig, firstEl } = this._outputSignature();
      if (sig === this._outputSig && firstEl === this._outputFirstEl) return;

      // Cache only on a successful render, so a transient miss (controls not yet
      // in the DOM) is retried on the next structural change rather than poisoning
      // the cache and leaving the toggle permanently missing.
      if (this.renderOutputArrangeControls()) {
        this._outputSig = sig;
        this._outputFirstEl = firstEl;
      }
    });
  }

  /**
   * A signature of what determines the output toggle: whether the output is
   * split, the number of extra output tabs (visibility), and the anchor output
   * stack element (where the toggle is rendered — which itself moves with the
   * orientation, so a flip re-renders the toggle).
   *
   * @returns {{ sig: string, firstEl: ?Element }}
   */
  _outputSignature() {
    const firstStack = this._anchorOutputStack();
    const firstEl = firstStack?.element?.[0] ?? null;
    const extra = this.getTabComponents().filter(
      (c) => c instanceof ImageTab || c instanceof CanvasTab
    ).length;
    return { sig: `${this.isOutputSplit()}|${extra}`, firstEl };
  }

  /**
   * Render the single split/merge toggle into the controls of the anchor output
   * stack (topmost when the split output is a column, rightmost when it is a row;
   * see _anchorOutputStack). The button reflects the current state: it splits the
   * output when it is a single stack, and merges it back when it is split. Shown
   * only when the output area holds more than one tab. Idempotent.
   *
   * Returns false (without disturbing any existing button) when the target
   * controls element is not in the DOM yet, so a transient miss never destroys a
   * good toggle.
   *
   * @returns {boolean} Whether the toggle was (re)rendered.
   */
  renderOutputArrangeControls() {
    const firstStack = this._anchorOutputStack();
    const $controls = firstStack
      ? $(firstStack.element).children('.lm_header').children('.lm_controls').first()
      : $();
    if ($controls.length === 0) return false;

    $('.output-arrange').remove();

    const split = this.isOutputSplit();
    const action = split ? 'stacked' : 'split';
    const icon = split ? '▤' : (this.vertical ? '▥' : '⬓');
    const title = split ? 'Merge the output tabs into one stack' : 'Split the output tabs';

    const $group = $(`
      <span class="output-arrange">
        <button type="button" class="output-arrange-btn" data-arrange="${action}"
          title="${title}">${icon}</button>
      </span>
    `);

    $group.on('click', '.output-arrange-btn', (event) => {
      this.arrangeOutput($(event.currentTarget).data('arrange'));
    });

    $controls.prepend($group);
    this.updateOutputControlsVisibility();
    return true;
  }

  /**
   * Show the output split/merge toggle only when the output area holds more than
   * one tab (i.e. the terminal plus at least one canvas/image).
   */
  updateOutputControlsVisibility() {
    const hasExtraOutput = this.getTabComponents().some(
      (component) => component instanceof ImageTab || component instanceof CanvasTab
    );
    $('.output-arrange').toggleClass('hidden', !hasExtraOutput);
  }
}
