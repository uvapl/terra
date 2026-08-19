declare type jQuery = HTMLElement & {
  [index: number]: HTMLElement;
  length: number;
};

declare namespace jQuery {
  type Element = HTMLElement;
}
