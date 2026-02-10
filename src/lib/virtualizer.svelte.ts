import {
  Virtualizer,
  type VirtualizerOptions,
  type VirtualItem,
  elementScroll,
  observeElementOffset,
  observeElementRect,
} from "@tanstack/virtual-core";

// Something opus wrote for virtual lists in svelte 5
export function createVirtualizer<TScrollElement extends Element>(
  options: () => Omit<
    VirtualizerOptions<TScrollElement, Element>,
    "observeElementRect" | "observeElementOffset" | "scrollToFn"
  >
) {
  let items = $state<VirtualItem[]>([]);
  let totalSize = $state(0);
  let scrollOffset = $state(0);

  const resolvedOptions: VirtualizerOptions<TScrollElement, Element> = {
    ...options(),
    observeElementRect,
    observeElementOffset,
    scrollToFn: elementScroll,
    onChange: (instance) => {
      items = instance.getVirtualItems();
      totalSize = instance.getTotalSize();
      scrollOffset = instance.scrollOffset ?? 0;
    },
  };

  const instance = new Virtualizer(resolvedOptions);

  $effect(() => {
    const opts = options();
    instance.setOptions({
      ...opts,
      observeElementRect,
      observeElementOffset,
      scrollToFn: elementScroll,
      onChange: (inst) => {
        items = inst.getVirtualItems();
        totalSize = inst.getTotalSize();
        scrollOffset = inst.scrollOffset ?? 0;
      },
    });
    instance._willUpdate();
  });

  $effect(() => {
    return instance._didMount();
  });

  return {
    get virtualizer() {
      return instance;
    },
    get items() {
      return items;
    },
    get totalSize() {
      return totalSize;
    },
    get scrollOffset() {
      return scrollOffset;
    },
  };
}
