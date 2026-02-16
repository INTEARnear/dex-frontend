<script lang="ts">
  import { focusFirstElement, trapFocusKeydown } from "./a11y";
  import { onDestroy } from "svelte";
  import { tokenHubStore } from "./tokenHubStore";
  import TokenIcon from "./TokenIcon.svelte";
  import Spinner from "./Spinner.svelte";
  import type { Token, TokenInfo } from "./types";
  import { formatAmount, formatCompact, formatCompactBalance } from "./utils";
  import { fade, fly } from "svelte/transition";
  import { createVirtualizer } from "./virtualizer.svelte";
  import { createChatwootModalVisibilityController } from "./chatwootBubbleVisibility";

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSelectToken: (token: Token) => void;
  }

  let { isOpen, onClose, onSelectToken }: Props = $props();
  let searchQuery = $state("");
  let searchInputRef = $state<HTMLInputElement | null>(null);
  let searchResults = $state<TokenInfo[]>([]);
  let isSearching = $state(false);
  let activeSearchId = 0;
  let hoveredToken = $state<TokenInfo | null>(null);
  let tooltipX = $state(0);
  let tooltipY = $state(0);
  let mobileTooltipToken = $state<TokenInfo | null>(null);
  let isMobile = $state(false);
  let supportsTouch = $state(false);
  let hoverSuppressUntil = $state(0);
  let longPressTimer: number | null = null;
  let longPressActive = $state(false);
  let touchStartX = 0;
  let touchStartY = 0;
  let scrollContainerRef = $state<HTMLDivElement | null>(null);
  let modalRef = $state<HTMLDivElement | null>(null);
  let previouslyFocusedElement: HTMLElement | null = null;
  const chatwootModalVisibility = createChatwootModalVisibilityController();

  onDestroy(() => {
    chatwootModalVisibility.dispose();
  });

  $effect(() => {
    chatwootModalVisibility.setVisible(isOpen);
  });

  $effect(() => {
    if (
      isOpen &&
      $tokenHubStore.tokens.length === 0 &&
      !$tokenHubStore.status.tokens
    ) {
      tokenHubStore.refreshTokens();
    }
  });

  $effect(() => {
    if (!isOpen) return;

    previouslyFocusedElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    queueMicrotask(() => {
      if (searchInputRef) {
        searchInputRef.focus();
      } else if (modalRef) {
        focusFirstElement(modalRef);
      }
    });

    return () => {
      previouslyFocusedElement?.focus();
      previouslyFocusedElement = null;
    };
  });

  $effect(() => {
    const mediaQuery = window.matchMedia("(max-width: 640px)");
    const touchQuery = window.matchMedia("(pointer: coarse)");
    const update = () => {
      isMobile = mediaQuery.matches;
      supportsTouch = navigator.maxTouchPoints > 0 || touchQuery.matches;
      if (!isMobile || !supportsTouch) {
        mobileTooltipToken = null;
        longPressActive = false;
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
    if (!isOpen) {
      hoveredToken = null;
      return;
    }
    if (supportsTouch) {
      hoverSuppressUntil = Date.now() + 500;
    } else {
      hoverSuppressUntil = Date.now() + 200;
    }
  });

  async function loadTokenIcon(tokenId: string) {
    await tokenHubStore.ensureTokenById(tokenId);
  }

  function handleTokenIntersection(entries: IntersectionObserverEntry[]) {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const tokenId = entry.target.getAttribute("data-token-id");
        if (tokenId) {
          loadTokenIcon(tokenId);
        }
      }
    });
  }

  let observer: IntersectionObserver | null = null;
  let pendingObserveNodes: HTMLElement[] = [];

  $effect(() => {
    if (isOpen) {
      observer = new IntersectionObserver(handleTokenIntersection, {
        root: null,
        rootMargin: "100px",
        threshold: 0.01,
      });

      // Observe any elements rendered before the observer was ready
      for (const node of pendingObserveNodes) {
        observer.observe(node);
      }
      pendingObserveNodes = [];

      return () => {
        observer?.disconnect();
        observer = null;
      };
    }
  });

  // Search effect
  $effect(() => {
    if (searchQuery.trim().length > 0) {
      performSearch(searchQuery.trim());
    } else {
      searchResults = [];
    }
  });

  async function performSearch(query: string) {
    const searchId = ++activeSearchId;
    isSearching = true;
    try {
      const results = await tokenHubStore.searchTokens(query);
      if (searchId !== activeSearchId) return;
      searchResults = results;
    } catch (error) {
      console.error("Search failed:", error);
      searchResults = [];
    } finally {
      if (searchId === activeSearchId) {
        isSearching = false;
      }
    }
  }

  const filteredTokens = $derived.by(() => {
    if (searchQuery.trim().length > 0) {
      return searchResults;
    }
    return $tokenHubStore.tokens;
  });

  const virtual = createVirtualizer<HTMLDivElement>(() => ({
    count: filteredTokens.length,
    getScrollElement: () => scrollContainerRef,
    estimateSize: () => 80,
    overscan: 50,
  }));

  function handleSelectToken(token: TokenInfo) {
    onSelectToken(token);
    onClose();
    searchQuery = "";
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      onClose();
    }
  }

  function handleModalKeyDown(e: KeyboardEvent) {
    if (!modalRef) return;

    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }

    trapFocusKeydown(e, modalRef);
  }

  function getTokenPrice(token: TokenInfo): string {
    return token.price_usd;
  }

  function formatPrice(token: TokenInfo): string {
    const num = parseFloat(getTokenPrice(token));
    if (num === 0) return "$0.00";
    return `$${formatAmount(num)}`;
  }

  function observeToken(node: HTMLElement) {
    if (observer) {
      observer.observe(node);
    } else {
      pendingObserveNodes.push(node);
    }
    return {
      destroy() {
        if (observer) {
          observer.unobserve(node);
        }
        pendingObserveNodes = pendingObserveNodes.filter((n) => n !== node);
      },
    };
  }

  function formatBalance(token: TokenInfo): string | null {
    const rawBalance = token.balance;
    return formatCompactBalance(rawBalance, token.metadata.decimals);
  }

  function formatDollarBalance(token: TokenInfo): string | null {
    const rawBalance = token.balance;
    if (rawBalance === undefined || rawBalance === null) return null;

    const decimals = token.metadata.decimals;
    const amount = Number(rawBalance) / Math.pow(10, decimals);
    const price = parseFloat(getTokenPrice(token));
    const usdValue = amount * (Number.isFinite(price) ? price : 0);

    if (!Number.isFinite(usdValue) || usdValue <= 0) return "$0.00";
    return `$${formatAmount(usdValue)}`;
  }

  function formatUsdCompact(value: number): string {
    if (!Number.isFinite(value)) return "N/A";
    if (value < 0) return "$0.00";
    if (value < 1000) return `$${formatCompact(value)}`;
    if (value < 1e6) return `$${formatCompact(value / 1e3)}K`;
    if (value < 1e9) return `$${formatCompact(value / 1e6)}M`;
    if (value < 1e12) return `$${formatCompact(value / 1e9)}B`;
    return `$${formatCompact(value / 1e12)}T`;
  }

  function getCirculatingSupply(token: TokenInfo): number {
    const supply = parseFloat(token.circulating_supply);
    if (!Number.isFinite(supply)) return 0;
    return supply / Math.pow(10, token.metadata.decimals);
  }

  function getTotalSupply(token: TokenInfo): number {
    const supply = parseFloat(token.total_supply);
    if (!Number.isFinite(supply)) return 0;
    return supply / Math.pow(10, token.metadata.decimals);
  }

  function formatMarketCap(token: TokenInfo): string {
    const marketCap =
      getCirculatingSupply(token) * parseFloat(getTokenPrice(token));
    return formatUsdCompact(marketCap);
  }

  function formatFdv(token: TokenInfo): string {
    const fdv = getTotalSupply(token) * parseFloat(getTokenPrice(token));
    return formatUsdCompact(fdv);
  }

  function formatPriceChange24h(token: TokenInfo): string {
    const current = parseFloat(token.price_usd_raw);
    const previous = parseFloat(token.price_usd_raw_24h_ago ?? "0");
    if (
      !Number.isFinite(current) ||
      !Number.isFinite(previous) ||
      previous <= 0
    ) {
      return "N/A";
    }
    const diff = current - previous;
    const percent = (diff / previous) * 100;
    const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
    return `${sign}${formatCompact(Math.abs(percent))}%`;
  }

  function getPriceChange24hDirection(token: TokenInfo): "up" | "down" | "flat" {
    const current = parseFloat(token.price_usd_raw);
    const previous = parseFloat(token.price_usd_raw_24h_ago ?? "0");
    if (
      !Number.isFinite(current) ||
      !Number.isFinite(previous) ||
      previous <= 0
    ) {
      return "flat";
    }
    if (current > previous) return "up";
    if (current < previous) return "down";
    return "flat";
  }

  function getLiquiditySeverity(token: TokenInfo): "low" | "medium" | "normal" {
    const liquidity = token.liquidity_usd;
    if (!Number.isFinite(liquidity)) return "normal";
    if (liquidity < 500) return "low";
    if (liquidity < 5000) return "medium";
    return "normal";
  }

  function getVolumeSeverity(token: TokenInfo): "low" | "normal" {
    const volume = token.volume_usd_24h;
    if (!Number.isFinite(volume)) return "normal";
    return volume < 500 ? "low" : "normal";
  }

  function handleTooltipMove(event: MouseEvent, token: TokenInfo) {
    if (Date.now() < hoverSuppressUntil) return;
    hoveredToken = token;
    tooltipX = event.clientX + 12;
    tooltipY = event.clientY + 12;
  }

  function handleTooltipLeave() {
    hoveredToken = null;
  }

  function handleTokenClick(token: TokenInfo) {
    if (longPressActive || mobileTooltipToken) {
      longPressActive = false;
      return;
    }
    handleSelectToken(token);
  }

  function handleTokenTouchStart(event: TouchEvent, token: TokenInfo) {
    if (!isMobile || !supportsTouch) return;
    event.preventDefault();
    longPressActive = false;
    const touch = event.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    if (longPressTimer) window.clearTimeout(longPressTimer);
    longPressTimer = setTimeout(() => {
      hoveredToken = null;
      mobileTooltipToken = token;
      longPressActive = true;
      if (navigator.vibrate) {
        navigator.vibrate(10);
      }
    }, 450);
  }

  function handleTokenTouchMove(event: TouchEvent) {
    if (!isMobile || !supportsTouch) return;
    if (!longPressTimer) return;
    event.preventDefault();
    const touch = event.touches[0];
    const deltaX = Math.abs(touch.clientX - touchStartX);
    const deltaY = Math.abs(touch.clientY - touchStartY);
    if (deltaX > 10 || deltaY > 10) {
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function handleTokenTouchEnd() {
    if (!isMobile || !supportsTouch) return;
    if (longPressTimer) window.clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  function handleModalClick(event: MouseEvent) {
    const target = event.target as HTMLElement | null;
    if (target?.closest(".token-tooltip")) return;
    hoveredToken = null;
  }

  function closeMobileTooltip() {
    mobileTooltipToken = null;
    longPressActive = false;
  }

</script>

{#if isOpen}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={handleBackdropClick}
    onkeydown={handleKeyDown}
    transition:fade={{ duration: 150 }}
  >
    <div
      class="modal"
      bind:this={modalRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      tabindex="-1"
      onclick={(e) => {
        e.stopPropagation();
        handleModalClick(e);
      }}
      onkeydown={handleModalKeyDown}
      transition:fly={{ y: 20, duration: 200 }}
    >
      <div class="modal-header">
        <h2 id="modal-title">Select a token</h2>
        <button class="close-btn" onclick={onClose} aria-label="Close">
          <svg
            width="24"
            height="24"
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

      <div class="search-box">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
        <input
          id="token-search-input"
          type="search"
          aria-label="Search tokens by ticker or address"
          placeholder="Search by ticker or address"
          bind:value={searchQuery}
          bind:this={searchInputRef}
        />
      </div>

      <div class="token-list" bind:this={scrollContainerRef}>
        {#if $tokenHubStore.status.tokens || isSearching}
          <div class="loading">
            <Spinner size={32} borderWidth={3} />
            <p>{isSearching ? "Searching..." : "Loading tokens..."}</p>
          </div>
        {:else if $tokenHubStore.errors.tokens}
          <div class="error">
            <p>Failed to load tokens</p>
            <button onclick={() => tokenHubStore.refreshTokens()}>Retry</button>
          </div>
        {:else if filteredTokens.length === 0}
          <div class="empty">
            <p>No tokens found</p>
          </div>
        {:else}
          <div
            class="virtual-list-container"
            style="height: {virtual.totalSize}px; position: relative;"
          >
            {#each virtual.items as virtualItem (virtualItem.key)}
              {@const token = filteredTokens[virtualItem.index]}
              {#if token}
                <button
                  class="token-item"
                  data-token-id={token.account_id}
                  data-index={virtualItem.index}
                  use:observeToken
                  onclick={() => handleTokenClick(token)}
                  onmouseenter={(event) => handleTooltipMove(event, token)}
                  onmousemove={(event) => handleTooltipMove(event, token)}
                  onmouseleave={handleTooltipLeave}
                  ontouchstart={(event) => handleTokenTouchStart(event, token)}
                  ontouchmove={handleTokenTouchMove}
                  ontouchend={handleTokenTouchEnd}
                  ontouchcancel={handleTokenTouchEnd}
                  oncontextmenu={(event) => event.preventDefault()}
                  style="position: absolute; top: 0; left: 0; width: 100%; height: {virtualItem.size}px; transform: translateY({virtualItem.start}px);"
                >
                  <div class="token-left">
                    <TokenIcon token={token} size={40} showBadge />
                    <div class="token-info">
                      <div class="token-symbol">{token.metadata.symbol}</div>
                      <div class="token-price-secondary">
                        {formatPrice(token)}
                      </div>
                    </div>
                  </div>
                  <div class="token-stats">
                    {#if formatBalance(token)}
                      <div class="token-balance-main">
                        {formatBalance(token)}
                      </div>
                    {/if}
                    {#if formatDollarBalance(token)}
                      <div class="token-balance-secondary">
                        Balance: {formatDollarBalance(token)}
                      </div>
                    {/if}
                  </div>
                </button>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
      {#if hoveredToken && (!isMobile || !supportsTouch)}
        <div
          class="token-tooltip"
          role="tooltip"
          style={`left: ${tooltipX}px; top: ${tooltipY}px;`}
        >
          <div class="tooltip-row">
            <span>Market cap</span>
            <span>{formatMarketCap(hoveredToken)}</span>
          </div>
          <div class="tooltip-row">
            <span>FDV</span>
            <span>{formatFdv(hoveredToken)}</span>
          </div>
          <div class="tooltip-row">
            <span>Liquidity</span>
            <span
              class:tooltip-low={getLiquiditySeverity(hoveredToken) === "low"}
              class:tooltip-medium={getLiquiditySeverity(hoveredToken) ===
                "medium"}
            >
              {formatUsdCompact(hoveredToken.liquidity_usd)}
            </span>
          </div>
          <div class="tooltip-row">
            <span>24h volume</span>
            <span
              class:tooltip-medium={getVolumeSeverity(hoveredToken) === "low"}
            >
              {formatUsdCompact(hoveredToken.volume_usd_24h)}
            </span>
          </div>
          <div class="tooltip-row">
            <span>24h price</span>
            <span
              class:tooltip-up={getPriceChange24hDirection(hoveredToken) ===
                "up"}
              class:tooltip-down={getPriceChange24hDirection(hoveredToken) ===
                "down"}
            >
              {formatPriceChange24h(hoveredToken)}
            </span>
          </div>
        </div>
      {/if}
      {#if mobileTooltipToken}
        <div
          class="mobile-tooltip-backdrop"
          role="button"
          tabindex="0"
          onclick={closeMobileTooltip}
          onkeydown={(e) => {
            if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
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
            onclick={(e) => e.stopPropagation()}
            onkeydown={(e) => e.stopPropagation()}
            transition:fly={{ y: 24, duration: 220 }}
          >
            <div class="mobile-tooltip-header">
              <div class="mobile-tooltip-title">
                {mobileTooltipToken.metadata.symbol} stats
              </div>
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
              <div class="tooltip-row">
                <span>Market cap</span>
                <span>{formatMarketCap(mobileTooltipToken)}</span>
              </div>
              <div class="tooltip-row">
                <span>FDV</span>
                <span>{formatFdv(mobileTooltipToken)}</span>
              </div>
              <div class="tooltip-row">
                <span>Liquidity</span>
                <span
                  class:tooltip-low={getLiquiditySeverity(
                    mobileTooltipToken,
                  ) === "low"}
                  class:tooltip-medium={getLiquiditySeverity(
                    mobileTooltipToken,
                  ) === "medium"}
                >
                  {formatUsdCompact(mobileTooltipToken.liquidity_usd)}
                </span>
              </div>
              <div class="tooltip-row">
                <span>24h volume</span>
                <span
                  class:tooltip-medium={getVolumeSeverity(
                    mobileTooltipToken,
                  ) === "low"}
                >
                  {formatUsdCompact(mobileTooltipToken.volume_usd_24h)}
                </span>
              </div>
              <div class="tooltip-row">
                <span>24h price</span>
                <span
                  class:tooltip-up={getPriceChange24hDirection(
                    mobileTooltipToken,
                  ) === "up"}
                  class:tooltip-down={getPriceChange24hDirection(
                    mobileTooltipToken,
                  ) === "down"}
                >
                  {formatPriceChange24h(mobileTooltipToken)}
                </span>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal {
    width: 100%;
    max-width: 480px;
    height: 70vh;
    max-height: 70vh;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 1.25rem;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5rem;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .close-btn {
    width: 2.5rem;
    height: 2.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .close-btn:hover {
    background: var(--bg-input);
    color: var(--text-primary);
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .search-box:focus-within {
    box-shadow: inset 0 -2px 0 var(--border-focus);
  }

  .search-box svg {
    color: var(--text-muted);
  }

  .search-box input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 1rem;
    color: var(--text-primary);
  }

  .search-box input:focus-visible {
    outline: none !important;
  }

  .search-box input::placeholder {
    color: var(--text-muted);
  }

  .token-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem;
    min-height: 0;
    contain: strict;
  }

  .virtual-list-container {
    width: 100%;
  }

  .token-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem;
    background: transparent;
    border: none;
    border-radius: 0.75rem;
    cursor: pointer;
    transition: background 0.2s ease;
    user-select: none;
    -webkit-user-select: none;
    touch-action: manipulation;
    box-sizing: border-box;
  }

  .token-item:hover {
    background: var(--bg-input);
  }

  .token-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
    min-width: 0;
  }

  /* Mobile: full-screen bottom sheet */
  @media (--tablet) {
    .modal-backdrop {
      padding: 0;
      align-items: flex-end;
    }

    .modal {
      max-width: 100%;
      width: 100%;
      height: 95dvh;
      max-height: 95dvh;
      border-radius: 1.25rem 1.25rem 0 0;
      border-bottom: none;
    }

    .modal-header {
      padding: 1rem 1.25rem;
    }

    h2 {
      font-size: 1.25rem;
    }

    .search-box {
      padding: 0.75rem 1.25rem;
    }

    .token-item {
      padding: 0.75rem;
    }

  }

  .token-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    flex: 1;
    min-width: 0;
  }

  .token-symbol {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
    font-family: "JetBrains Mono", monospace;
  }

  .token-price-secondary {
    font-size: 0.875rem;
    color: var(--text-secondary);
    font-family: "JetBrains Mono", monospace;
  }

  .token-stats {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  .token-balance-main {
    font-size: 0.875rem;
    font-weight: 600;
    padding: 0.25rem 0.625rem;
    background: linear-gradient(135deg, var(--accent-primary), #2563eb);
    color: white;
    border-radius: 0.5rem;
    font-family: "JetBrains Mono", monospace;
  }

  .token-balance-secondary {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .token-tooltip {
    position: fixed;
    min-width: 220px;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
    padding: 0.75rem;
    box-shadow: 0 12px 20px -8px rgba(0, 0, 0, 0.5);
    pointer-events: none;
    z-index: 1100;
    user-select: none;
  }

  .tooltip-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
    font-family: "JetBrains Mono", monospace;
  }

  .tooltip-up {
    color: var(--success, #22c55e);
  }

  .tooltip-down {
    color: var(--error, #ef4444);
  }

  .tooltip-medium {
    color: var(--warning, #eab308);
  }

  .tooltip-low {
    color: var(--error, #ef4444);
  }

  .tooltip-row + .tooltip-row {
    margin-top: 0.5rem;
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

  .mobile-tooltip-body .tooltip-row {
    font-size: 0.9rem;
  }

  .loading,
  .error,
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 3rem 1rem;
    gap: 1rem;
  }

  .loading p,
  .error p,
  .empty p {
    margin: 0;
    color: var(--text-secondary);
  }

  .error button {
    padding: 0.5rem 1rem;
    background: var(--accent-button-small);
    border: none;
    border-radius: 0.5rem;
    color: white;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.2s ease;
  }

  .error button:hover {
    background: var(--accent-hover);
  }

</style>
