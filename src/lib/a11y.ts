const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function isFocusableElementVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    (element) =>
      isFocusableElementVisible(element) && !element.hasAttribute("inert"),
  );
}

export function focusFirstElement(container: HTMLElement): void {
  const focusable = getFocusableElements(container);
  if (focusable.length > 0) {
    focusable[0].focus();
    return;
  }
  container.focus();
}

export function trapFocusKeydown(
  event: KeyboardEvent,
  container: HTMLElement,
): void {
  if (event.key !== "Tab") return;

  const focusable = getFocusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const isInsideContainer = active !== null && container.contains(active);

  if (event.shiftKey) {
    if (!isInsideContainer || active === first) {
      event.preventDefault();
      last.focus();
    }
    return;
  }

  if (!isInsideContainer || active === last) {
    event.preventDefault();
    first.focus();
  }
}
