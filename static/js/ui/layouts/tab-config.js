/**
 * Builder for tab component configurations that GoldenLayout needs.
 *
 * @param {object} [config] - item config: `kind` selects the
 * component (default 'editor') and `componentState` is merged into the
 * defaults
 * @param {object} [stateDefaults] - default componentState (font size, theme)
 * @returns {object} the complete item config
 */
export function createTabConfig(config = {}, stateDefaults = {}) {
  const { kind, componentState, ...rest } = config;

  return {
    type: 'component',
    componentType: kind || 'editor',
    title: 'Untitled',
    ...rest,
    componentState: {
      ...stateDefaults,
      ...componentState,
    },
  };
}

/**
 * The component type of a GoldenLayout node.
 *
 * @param {ComponentItem|object} item - an item object or raw item config
 * @returns {?string} the component type, or null for non-component nodes
 */
export function componentTypeOf(item) {
  return item?.componentType ?? null;
}

/**
 * Whether the given GoldenLayout node is a (text) editor.
 *
 * @param {ContentItem|object} item - an item object or raw item config
 * @returns {boolean}
 */
export function isEditorItem(item) {
  return componentTypeOf(item) === 'editor';
}

/**
 * Whether the given GoldenLayout node is an output tab (terminal, canvas or
 * image). Non-component nodes are also not output tabs.
 *
 * @param {ContentItem|object} item - an item object or raw item config
 * @returns {boolean}
 */
export function isOutputItem(item) {
  const type = componentTypeOf(item);
  return type !== null && type !== 'editor';
}
