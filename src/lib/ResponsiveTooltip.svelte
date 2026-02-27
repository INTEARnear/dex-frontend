<script lang="ts">
  import { onDestroy } from "svelte";
  import type { Snippet } from "svelte";
  import { get } from "svelte/store";
  import { fade, fly } from "svelte/transition";
  import { createChatwootModalVisibilityController } from "./chatwootBubbleVisibility";
  import {
    activeFloatingTooltipId,
    activeMobileTooltipId,
    createTooltipId,
  } from "./tooltipState";

  interface Props {
    title: string;
    content: Snippet;
    children: Snippet;
  }

  let { title, content, children }: Props = $props();

  const tooltipId = createTooltipId();
  const desktopTooltipOffsetPx = 12;
  const desktopTooltipSidePaddingPx = 16;
  let hovered = $state(false);
  let tooltipX = $state(0);
  let tooltipY = $state(0);
  let tooltipFlippedLeft = $state(false);
  let tooltipElement = $state<HTMLDivElement | null>(null);
  let tooltipWidthPx = $state(0);
  let lastPointerX = $state<number | null>(null);
  let lastPointerY = $state<number | null>(null);
  let mobileOpen = $state(false);
  let isMobile = $state(false);
  let supportsTouch = $state(false);
  let hoverSuppressUntil = $state(0);
  let longPressTimer: number | null = null;
  let longPressActive = $state(false);
  let touchStartX = 0;
  let touchStartY = 0;
  let triggerElement = $state<HTMLSpanElement | null>(null);
  const chatwootModalVisibility = createChatwootModalVisibilityController();

  onDestroy(() => {
    if (longPressTimer) {
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    if (get(activeFloatingTooltipId) === tooltipId) {
      activeFloatingTooltipId.set(null);
    }
    if (get(activeMobileTooltipId) === tooltipId) {
      activeMobileTooltipId.set(null);
    }
    chatwootModalVisibility.dispose();
  });

  $effect(() => {
    chatwootModalVisibility.setVisible(mobileOpen);
  });

  $effect(() => {
    const mediaQuery = window.matchMedia("(max-width: 640px)");
    const touchQuery = window.matchMedia("(pointer: coarse)");
    const update = () => {
      isMobile = mediaQuery.matches;
      supportsTouch = navigator.maxTouchPoints > 0 || touchQuery.matches;
      if (!isMobile || !supportsTouch) {
        mobileOpen = false;
        longPressActive = false;
        if (get(activeMobileTooltipId) === tooltipId) {
          activeMobileTooltipId.set(null);
        }
      }
    };
    update();
    mediaQuery.addEventListener("change", update);
    touchQuery.addEventListener("change", update);
    return () => {
      mediaQuery.removeEventListener("change", update);
      touchQuery.removeEventListener("change", update);
    };
  });

  $effect(() => {
    if (isMobile && supportsTouch) {
      hoverSuppressUntil = Date.now() + 500;
    } else {
      hoverSuppressUntil = Date.now() + 200;
    }
  });

  $effect(() => {
    const activeFloatingId = $activeFloatingTooltipId;
    if (activeFloatingId !== tooltipId && hovered) {
      hovered = false;
    }
  });

  $effect(() => {
    const activeMobileId = $activeMobileTooltipId;
    if (activeMobileId !== tooltipId && mobileOpen) {
      mobileOpen = false;
      longPressActive = false;
    }
  });

  $effect(() => {
    if (!tooltipElement) return;
    const element = tooltipElement;

    const updateWidth = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) {
        tooltipWidthPx = width;
      }
    };

    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  });

  $effect(() => {
    if (
      !hovered ||
      (isMobile && supportsTouch) ||
      tooltipWidthPx <= 0 ||
      lastPointerX === null ||
      lastPointerY === null
    ) {
      return;
    }
    updateDesktopTooltipPosition(lastPointerX, lastPointerY);
  });

  function updateDesktopTooltipPosition(clientX: number, clientY: number): void {
    tooltipY = clientY + desktopTooltipOffsetPx;
    const tooltipRightX = clientX + desktopTooltipOffsetPx;
    const rightEdge = window.innerWidth - desktopTooltipSidePaddingPx;
    const rightPlacementOverflows =
      tooltipWidthPx > 0 && tooltipRightX + tooltipWidthPx > rightEdge;
    const distanceToLeftEdge = Math.max(clientX - desktopTooltipSidePaddingPx, 0);
    const distanceToRightEdge = Math.max(rightEdge - clientX, 0);
    const rightSideIsClosest = distanceToRightEdge <= distanceToLeftEdge;
    tooltipFlippedLeft = rightPlacementOverflows && rightSideIsClosest;
    tooltipX = tooltipFlippedLeft
      ? clientX - desktopTooltipOffsetPx
      : tooltipRightX;
  }

  function handleTooltipMove(event: MouseEvent) {
    if (isMobile && supportsTouch) return;
    if (Date.now() < hoverSuppressUntil) return;
    hovered = true;
    activeMobileTooltipId.set(null);
    activeFloatingTooltipId.set(tooltipId);
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    updateDesktopTooltipPosition(event.clientX, event.clientY);
  }

  function handleTooltipLeave() {
    clearFloatingTooltip();
  }

  function clearFloatingTooltip() {
    hovered = false;
    tooltipFlippedLeft = false;
    lastPointerX = null;
    lastPointerY = null;
    if (get(activeFloatingTooltipId) === tooltipId) {
      activeFloatingTooltipId.set(null);
    }
  }

  function handleTouchStart(event: TouchEvent) {
    if (!isMobile || !supportsTouch) return;
    longPressActive = false;
    const touch = event.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    if (longPressTimer) window.clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      hovered = false;
      activeFloatingTooltipId.set(null);
      activeMobileTooltipId.set(tooltipId);
      mobileOpen = true;
      longPressActive = true;
      if (navigator.vibrate) {
        navigator.vibrate(10);
      }
    }, 450);
  }

  function handleTouchMove(event: TouchEvent) {
    if (!isMobile || !supportsTouch) return;
    if (!longPressTimer) return;
    const touch = event.touches[0];
    const deltaX = Math.abs(touch.clientX - touchStartX);
    const deltaY = Math.abs(touch.clientY - touchStartY);
    if (deltaX > 10 || deltaY > 10) {
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function handleTouchEnd() {
    if (!isMobile || !supportsTouch) return;
    if (longPressTimer) window.clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  function handleClick(event: MouseEvent) {
    if (longPressActive || mobileOpen) {
      event.preventDefault();
      event.stopPropagation();
      longPressActive = false;
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (longPressActive || mobileOpen) {
      event.preventDefault();
      event.stopPropagation();
      longPressActive = false;
    }
  }

  function closeMobileTooltip() {
    if (get(activeMobileTooltipId) === tooltipId) {
      activeMobileTooltipId.set(null);
    }
    mobileOpen = false;
    longPressActive = false;
  }

  $effect(() => {
    if (!supportsTouch || isMobile || !hovered || $activeFloatingTooltipId !== tooltipId) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      const target = event.target;
      if (!(target instanceof Node)) {
        clearFloatingTooltip();
        return;
      }
      if (triggerElement?.contains(target)) return;
      clearFloatingTooltip();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  });
</script>

<span
  class="tooltip-trigger"
  bind:this={triggerElement}
  role="button"
  tabindex="0"
  aria-label={title}
  onmouseenter={handleTooltipMove}
  onmousemove={handleTooltipMove}
  onmouseleave={handleTooltipLeave}
  ontouchstart={handleTouchStart}
  ontouchmove={handleTouchMove}
  ontouchend={handleTouchEnd}
  ontouchcancel={handleTouchEnd}
  onclick={handleClick}
  onkeydown={handleKeydown}
  oncontextmenu={(event) => event.preventDefault()}
>
  {@render children()}
</span>

{#if hovered && (!isMobile || !supportsTouch) && $activeFloatingTooltipId === tooltipId}
  <div
    class="detail-tooltip"
    bind:this={tooltipElement}
    role="tooltip"
    style={`left: ${tooltipX}px; top: ${tooltipY}px; ${tooltipFlippedLeft ? "transform: translateX(-100%);" : ""}`}
  >
    {@render content()}
  </div>
{/if}

{#if mobileOpen && $activeMobileTooltipId === tooltipId}
  <div
    class="mobile-tooltip-backdrop"
    role="button"
    tabindex="0"
    oncontextmenu={(event) => event.preventDefault()}
    onclick={closeMobileTooltip}
    onkeydown={(event) => {
      if (
        event.key === "Escape" ||
        event.key === "Enter" ||
        event.key === " "
      ) {
        closeMobileTooltip();
      }
    }}
    transition:fade={{ duration: 180 }}
  >
    <div
      class="mobile-tooltip-sheet"
      role="dialog"
      aria-modal="true"
      tabindex="0"
      oncontextmenu={(event) => event.preventDefault()}
      onclick={(event) => event.stopPropagation()}
      onkeydown={(event) => event.stopPropagation()}
      transition:fly={{ y: 24, duration: 220 }}
    >
      <div class="mobile-tooltip-header">
        <div class="mobile-tooltip-title">{title}</div>
        <button
          class="mobile-tooltip-close"
          onclick={closeMobileTooltip}
          aria-label="Close"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
      <div class="mobile-tooltip-body">
        {@render content()}
      </div>
    </div>
  </div>
{/if}

<style>
  .tooltip-trigger {
    display: contents;
  }

  .detail-tooltip {
    position: fixed;
    min-width: 220px;
    max-width: min(320px, calc(100vw - 2rem));
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
    padding: 0.75rem;
    box-shadow: 0 12px 20px -8px rgba(0, 0, 0, 0.5);
    pointer-events: none;
    z-index: 1100;
    user-select: none;
  }

  .mobile-tooltip-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 1101;
    display: flex;
    align-items: flex-end;
  }

  .mobile-tooltip-sheet {
    width: 100%;
    background: var(--bg-card);
    border-top: 1px solid var(--border-color);
    border-radius: 1rem 1rem 0 0;
    padding: 1rem 1.25rem 1.5rem;
    box-shadow: 0 -12px 20px -8px rgba(0, 0, 0, 0.5);
    user-select: none;
  }

  .mobile-tooltip-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
    gap: 1rem;
  }

  .mobile-tooltip-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .mobile-tooltip-close {
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .mobile-tooltip-close:hover {
    background: var(--bg-input);
    color: var(--text-primary);
  }

  .mobile-tooltip-body {
    color: var(--text-secondary);
  }
</style>
