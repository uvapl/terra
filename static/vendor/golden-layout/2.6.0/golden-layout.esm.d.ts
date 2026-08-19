// Minimal ambient types for GoldenLayout 2.6.0, covering only the API
// surface this codebase actually touches. Not a full port of the
// upstream .d.ts.
//
// ContentItem/ComponentItem/Stack/Tab/etc. are declared globally so bare
// JSDoc references like `@param {ComponentItem}` resolve throughout the
// codebase without every file having to import the type.

declare global {
  class EventEmitter {
    on(eventName: string, callback: (...args: any[]) => void): void;
    off(eventName: string, callback?: (...args: any[]) => void): void;
    emit(eventName: string, ...args: any[]): void;
  }

  class ContentItem extends EventEmitter {
    readonly type: string;
    readonly id: string;
    readonly isRow: boolean;
    readonly isColumn: boolean;
    readonly isStack: boolean;
    readonly isComponent: boolean;
    readonly isGround: boolean;
    readonly parent: ContentItem | null;
    readonly contentItems: ContentItem[];
    readonly element: HTMLElement;

    addChild(itemConfig: ContentItem | GLItemConfig, index?: number): void;
    removeChild(contentItem: ContentItem, keepChild?: boolean): void;
    replaceChild(oldChild: ContentItem, newChild: ContentItem | GLItemConfig): void;
    toConfig(): GLItemConfig;
  }

  class Stack extends ContentItem {
    getActiveComponentItem(): ComponentItem | undefined;
    setActiveComponentItem(componentItem: ComponentItem, focus?: boolean): void;
  }

  class ComponentItem extends ContentItem {
    readonly componentType: string;
    readonly container: ComponentContainer;
    readonly parent: Stack;
  }

  class ComponentContainer extends EventEmitter {
    readonly element: HTMLElement;
    readonly parent: ComponentItem;
  }

  class Tab {
    readonly element: HTMLElement;
    readonly componentItem: ComponentItem;
    readonly contentItem: ContentItem;
  }

  // Named GLItemConfig/GLLayoutConfig globally to avoid clashing with the
  // real ItemConfig/LayoutConfig namespace objects exported below.
  interface GLItemConfig {
    type: string;
    content?: GLItemConfig[];
    componentType?: string;
    componentState?: object;
    id?: string;
    isClosable?: boolean;
    [key: string]: any;
  }

  interface GLLayoutConfig {
    root?: GLItemConfig;
    content?: GLItemConfig[];
    [key: string]: any;
  }
}

// Real module exports, matching what layout.js actually imports and calls
// (e.g. `ItemConfig.resolve(...)`, `LayoutConfig.fromResolved(...)`).

export class GoldenLayout extends EventEmitter {
  constructor(container: HTMLElement);
  readonly isInitialised: boolean;
  readonly rootItem: ContentItem | undefined;
  readonly groundItem: ContentItem | undefined;

  registerComponent(name: string, componentConstructor: any): void;
  init(): void;
  loadLayout(config: GLLayoutConfig): void;
  saveLayout(): GLLayoutConfig;
  addComponent(componentType: string, componentState?: object, title?: string): void;
  getItemsByType(type: string): ContentItem[];
}

export namespace ItemConfig {
  function resolve(itemConfig: GLItemConfig, isChild?: boolean): GLItemConfig;
}

export namespace LayoutConfig {
  function fromResolved(config: GLLayoutConfig): GLLayoutConfig;
}
