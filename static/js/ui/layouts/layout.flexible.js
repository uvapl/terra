import Layout from './layout.js';
import { isEditorItem, isOutputItem } from './tab-config.js';

/**
 * An output tab other than the terminal.
 *
 * @param {BaseTab} component
 * @returns {boolean}
 */
function isExtraOutput(component) {
  const type = component.getComponentName();
  return type === 'image' || type === 'canvas';
}

/**
 * Id of the container that holds the output area.
 * @type {string}
 */
const OUTPUT_AREA_ID = 'outputArea';

/**
 * Whether the item is, or contains, an output tab.
 *
 * @param {ContentItem} item
 * @returns {boolean}
 */
function holdsOutput(item) {
  return item.isComponent ? isOutputItem(item) : (item.contentItems || []).some(holdsOutput);
}

/**
 * A layout the user can restructure at runtime, on top of the base Layout,
 * which places tabs but does not let the user rearrange them.
 *
 * Tabs belong to one of two areas and never share a stack across them: the
 * editors, and the output (terminal, canvas, images). Either area may be spread
 * over several stacks — by dragging a tab out, or through the output's
 * split/merge toggle. All output stacks are kept together in one container, so
 * that output never ends up beside the editors; that container is the one item
 * of the area that is never removed, so the area survives however its stacks
 * come and go.
 *
 * Restructuring moves live components between stacks and never recreates them:
 * editors keep their history, the terminal its scrollback and worker.
 */
export default class FlexibleLayout extends Layout {
  /**
   * Put the output area below the editors (vertical) or beside them
   * (horizontal).
   *
   * @param {'horizontal'|'vertical'} orientation
   */
  setOrientation(orientation) {
    if (orientation !== 'horizontal' && orientation !== 'vertical') return;
    if (this._orientation === orientation) return;

    const oldMain = this.getMainContainer();
    if (!oldMain) { this._orientation = orientation; return; }

    const mainType = orientation === 'vertical' ? 'column' : 'row';
    const outputType = orientation === 'vertical' ? 'row' : 'column';

    const children = [...oldMain.contentItems];

    const newMain = this._createItem(
      { type: mainType, content: [], isClosable: false }, this.root
    );
    this.root.replaceChild(oldMain, newMain);

    for (const child of children) {
      if (!child.isStack && holdsOutput(child)) {
        const perp = this._createItem(
          { type: outputType, content: [], id: child.id, isClosable: false }, newMain
        );
        newMain.addChild(perp);
        [...child.contentItems].forEach((item) => perp.addChild(item));
      } else {
        newMain.addChild(child);
      }
    }

    this._orientation = orientation;
    this._afterOrientationChanged();
  }

  /**
   * Bring the menu, the output toggle and the components' geometry back in line
   * with the orientation.
   */
  _afterOrientationChanged() {
    $('#menu-item--orientation-horizontal').toggleClass('active', !this.vertical);
    $('#menu-item--orientation-vertical').toggleClass('active', this.vertical);

    this._scheduleOutputControlsRefresh();
    this.refresh();
  }

  /**
   * Set up the output area and its controls once the layout is initialised, and
   * keep them in line with every later change. Overrides the base no-op hook.
   */
  _initStructureControls() {
    this._ensureOutputWrapper();
    this._tagAreas();
    if (this.renderOutputArrangeControls()) {
      const { sig, firstEl } = this._outputSignature();
      this._outputSig = sig;
      this._outputFirstEl = firstEl;
    }

    this.on('stateChanged', () => this._scheduleOutputControlsRefresh());
  }

  /**
   * The container holding the output area, built around whatever output the tree
   * has when there is none yet.
   *
   * @returns {?ContentItem}
   */
  _ensureOutputWrapper() {
    const main = this.getMainContainer();
    if (!main) return null;

    const existing = main.contentItems.find((item) => item.id === OUTPUT_AREA_ID);
    if (existing) return existing;

    const wrapper = this._createItem(
      { type: this.vertical ? 'row' : 'column', id: OUTPUT_AREA_ID, isClosable: false, content: [] },
      main,
    );

    const children = main.contentItems.filter(holdsOutput);
    if (children.length === 0) {
      main.addChild(wrapper);
      return wrapper;
    }

    main.replaceChild(children[0], wrapper);
    children.forEach((child) => {
      if (main.contentItems.indexOf(child) !== -1) main.removeChild(child, true);
      wrapper.addChild(child);
    });

    return wrapper;
  }

  /**
   * The output stack whose header carries the split/merge toggle: the one in the
   * outer corner of the output area.
   *
   * @returns {?Stack}
   */
  _anchorOutputStack() {
    const outputStacks = this._allStacks().filter((stack) => this._isOutputStack(stack));
    if (outputStacks.length === 0) return null;
    return this.vertical ? outputStacks[outputStacks.length - 1] : outputStacks[0];
  }

  /**
   * Mark which area each stack belongs to, for the drag constraint to read.
   */
  _tagAreas() {
    this._allStacks().forEach((stack) => {
      if (this._isEditorStack(stack)) stack._terraArea = 'editor';
      else if (stack.contentItems.length > 0) stack._terraArea = 'output';
    });
  }

  /**
   * Whether this is the only editor stack, and so has to keep its last tab.
   *
   * @param {Stack} stack
   * @returns {boolean}
   */
  isSoleEditorStack(stack) {
    if (!stack?.isStack || !this._isEditorStack(stack)) return false;
    return this._allStacks().filter((s) => this._isEditorStack(s)).length === 1;
  }

  /**
   * Arrange a newly added output tab the way the user last chose.
   */
  _applyOutputArrangementPreference() {
    const arrangement = this.delegate?.getStoredOutputArrangement?.();
    if (arrangement) {
      this.arrangeOutput(arrangement);
    }
  }

  /** @returns {boolean} Whether the output tabs are spread over several stacks. */
  isOutputSplit() {
    return this._allStacks().filter((stack) => this._isOutputStack(stack)).length > 1;
  }

  /**
   * A stack to put a dragged tab in when its own stack is gone and the drop
   * landed nowhere.
   *
   * @param {ContentItem} contentItem
   * @param {?Stack} originalParent - The tab's stack at drag start.
   * @returns {?Stack} Null to leave the drop to GoldenLayout.
   */
  ensureDropHome(contentItem, originalParent) {
    const stacks = this._allStacks();

    if (originalParent && stacks.includes(originalParent)) return null;

    const isEditor = isEditorItem(contentItem);
    const home = stacks.find((stack) => isEditor ? this._isEditorStack(stack) : this._isOutputStack(stack));
    if (home) return home;

    const parent = isEditor ? this.getMainContainer() : this._ensureOutputWrapper();
    if (!parent) return null;

    const index = isEditor ? 0 : parent.contentItems.length;
    parent.addChild(this._createItem({ type: 'stack', isClosable: true }, parent), index);
    return parent.contentItems[index] ?? null;
  }

  /**
   * Gather the output tabs into one stack, or give each of them a stack of its
   * own across the output area. Leaves the editors untouched.
   *
   * @param {'stacked'|'split'} mode
   */
  arrangeOutput(mode) {
    const wrapper = this._ensureOutputWrapper();
    if (!wrapper) return;

    const oldStacks = this._allStacks().filter((stack) => this._isOutputStack(stack));
    const comps = oldStacks.flatMap((stack) => stack.contentItems.filter(isOutputItem));
    if (comps.length === 0) return;

    const split = mode === 'split' && comps.length > 1;

    if (split ? oldStacks.length === comps.length : oldStacks.length === 1) return;

    const newStacks = (split ? comps : [null]).map(() => {
      const stack = this._createItem(
        split ? { type: 'stack' } : { type: 'stack', id: 'outputStack' }, wrapper,
      );
      wrapper.addChild(stack);
      return stack;
    });

    // Moved, not recreated; the stacks left empty then remove themselves.
    comps.forEach((comp, index) => {
      comp.parent.removeChild(comp, true);
      newStacks[split ? index : 0].addChild(comp);
    });

    this.outputStack = newStacks[0];
    this._scheduleOutputControlsRefresh();
  }

  /**
   * Bring the area tags and the output toggle in line with the tree, at most
   * once per tick.
   */
  _scheduleOutputControlsRefresh() {
    if (this._outputRefreshScheduled) return;
    this._outputRefreshScheduled = true;
    setTimeout(() => {
      this._outputRefreshScheduled = false;
      this._tagAreas();

      const { sig, firstEl } = this._outputSignature();
      if (sig === this._outputSig && firstEl === this._outputFirstEl) return;

      if (this.renderOutputArrangeControls()) {
        this._outputSig = sig;
        this._outputFirstEl = firstEl;
      }
    });
  }

  /**
   * Everything the output toggle's appearance and placement depend on.
   *
   * @returns {{ sig: string, firstEl: ?Element }}
   */
  _outputSignature() {
    const firstStack = this._anchorOutputStack();
    const firstEl = firstStack?.element ?? null;
    const extra = this.getTabComponents().filter(isExtraOutput).length;
    return { sig: `${this.isOutputSplit()}|${extra}`, firstEl };
  }

  /**
   * Render the split/merge toggle, showing the arrangement it switches to.
   *
   * @returns {boolean} Whether it was rendered; false leaves an existing toggle
   * alone, to be retried on the next change.
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
      const arrangement = $(event.currentTarget).data('arrange');

      this.delegate?.setStoredOutputArrangement?.(arrangement);
      this.arrangeOutput(arrangement);
    });

    $controls.prepend($group);
    this.updateOutputControlsVisibility();
    return true;
  }

  /**
   * Show the toggle only when the output area holds more than the terminal.
   */
  updateOutputControlsVisibility() {
    const hasExtraOutput = this.getTabComponents().some(isExtraOutput);
    $('.output-arrange').toggleClass('hidden', !hasExtraOutput);
  }
}
