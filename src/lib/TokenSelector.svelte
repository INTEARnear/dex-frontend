<script lang="ts">
  import { tokenStore } from "./tokenStore";
  import { walletStore } from "./walletStore";
  import { userBalances } from "./balanceStore";
  import TokenBadge from "./TokenBadge.svelte";
  import type { Token } from "./types";
  import {
    formatAmount,
    formatCompact,
    formatCompactBalance,
    PRICES_API,
  } from "./utils";
  import { priceStore } from "./priceStore";
  import { fade, fly } from "svelte/transition";
  import { createVirtualizer } from "./virtualizer.svelte";

  interface Props {
    isOpen: boolean;
    onClose: () => void;
    onSelectToken: (token: Token) => void;
  }

  let { isOpen, onClose, onSelectToken }: Props = $props();
  let searchQuery = $state("");
  let tokenIcons = $state<Record<string, string | null>>({});
  let loadingIcons = $state<Set<string>>(new Set());
  let searchResults = $state<Token[]>([]);
  let isSearching = $state(false);
  let searchAbortController: AbortController | null = null;
  const pricesCache = $derived($priceStore);
  let hoveredToken = $state<Token | null>(null);
  let tooltipX = $state(0);
  let tooltipY = $state(0);
  let mobileTooltipToken = $state<Token | null>(null);
  let isMobile = $state(false);
  let supportsTouch = $state(false);
  let hoverSuppressUntil = $state(0);
  let longPressTimer: number | null = null;
  let longPressActive = $state(false);
  let touchStartX = 0;
  let touchStartY = 0;
  let scrollContainerRef = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (isOpen && $tokenStore.tokens.length === 0 && !$tokenStore.isLoading) {
      const accountId = $walletStore.accountId;
      tokenStore.fetchTokens(accountId ?? undefined);
    }
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
    }
  });

  // Preload icons from tokens with balances
  $effect(() => {
    if ($tokenStore.tokens.length > 0) {
      const newIcons: Record<string, string | null> = {};
      for (const token of $tokenStore.tokens) {
        if (token.preloadedIcon && !(token.account_id in tokenIcons)) {
          newIcons[token.account_id] = token.preloadedIcon;
        }
      }
      if (Object.keys(newIcons).length > 0) {
        tokenIcons = { ...tokenIcons, ...newIcons };
      }
    }
  });

  async function loadTokenIcon(tokenId: string) {
    // Skip if already loading or loaded
    if (loadingIcons.has(tokenId) || tokenId in tokenIcons) {
      return;
    }

    loadingIcons.add(tokenId);
    loadingIcons = loadingIcons; // Trigger reactivity

    try {
      const response = await fetch(`${PRICES_API}/token?token_id=${tokenId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.metadata?.icon && data.metadata.icon.startsWith("data:")) {
          tokenIcons[tokenId] = data.metadata.icon;
          tokenIcons = { ...tokenIcons }; // Trigger reactivity
        } else {
          tokenIcons[tokenId] = null;
          tokenIcons = { ...tokenIcons };
        }
      }
    } catch (error) {
      console.error(`Failed to load icon for ${tokenId}:`, error);
      tokenIcons[tokenId] = null;
      tokenIcons = { ...tokenIcons };
    } finally {
      loadingIcons.delete(tokenId);
      loadingIcons = loadingIcons;
    }
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
    searchAbortController?.abort();
    const controller = new AbortController();
    searchAbortController = controller;

    isSearching = true;
    try {
      const acc = $walletStore.accountId
        ? `&acc=${$walletStore.accountId}`
        : "";
      const response = await fetch(
        `${PRICES_API}/token-search?q=${encodeURIComponent(query)}&n=100${acc}`,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      if (response.ok) {
        let results: Token[] = await response.json();
        if (controller.signal.aborted) return;

        // If query matches "NEAR" partially, put NEAR token at top
        if (
          "near".includes(query.toLowerCase()) ||
          query.toLowerCase().includes("near")
        ) {
          // Remove NEAR from results if present
          results = results.filter((token) => token.account_id !== "near");
          // Find NEAR token from store or create it
          const nearToken = $tokenStore.tokens.find(
            (t) => t.account_id === "near",
          );
          if (nearToken) {
            results.unshift(nearToken);
          }
        }

        searchResults = results;
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("Search failed:", error);
      searchResults = [];
    } finally {
      if (!controller.signal.aborted) {
        isSearching = false;
      }
    }
  }

  const filteredTokens = $derived.by(() => {
    if (searchQuery.trim().length > 0) {
      const balances = $userBalances;
      return searchResults.map((token) => {
        const balance = balances[token.account_id];
        return balance !== undefined
          ? { ...token, userBalance: balance }
          : token;
      });
    }
    return $tokenStore.tokens;
  });

  const virtual = createVirtualizer<HTMLDivElement>(() => ({
    count: filteredTokens.length,
    getScrollElement: () => scrollContainerRef,
    estimateSize: () => 80,
    overscan: 50,
  }));

  function handleSelectToken(token: Token) {
    // Build updated token with latest price and icon
    const icon = tokenIcons[token.account_id];
    const latestPrice = pricesCache[token.account_id];

    const updatedToken: Token = {
      ...token,
      ...(latestPrice && { price_usd: latestPrice }),
      metadata: {
        ...token.metadata,
        ...(icon && { icon }),
      },
    };

    onSelectToken(updatedToken);
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

  function getTokenPrice(token: Token): string {
    return pricesCache[token.account_id] ?? token.price_usd;
  }

  function formatPrice(token: Token): string {
    const num = parseFloat(getTokenPrice(token));
    if (num === 0) return "$0.00";
    return `$${formatAmount(num)}`;
  }

  function getTokenIcon(tokenId: string): string | null {
    return tokenIcons[tokenId] ?? null;
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

  function formatBalance(token: Token): string | null {
    const rawBalance =
      (token as any).userBalance ?? $userBalances[token.account_id];
    return formatCompactBalance(rawBalance, token.metadata.decimals);
  }

  function formatDollarBalance(token: Token): string | null {
    const rawBalance =
      (token as any).userBalance ?? $userBalances[token.account_id];
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

  function getCirculatingSupply(token: Token): number {
    const supply = parseFloat(token.circulating_supply);
    if (!Number.isFinite(supply)) return 0;
    return supply / Math.pow(10, token.metadata.decimals);
  }

  function getTotalSupply(token: Token): number {
    const supply = parseFloat(token.total_supply);
    if (!Number.isFinite(supply)) return 0;
    return supply / Math.pow(10, token.metadata.decimals);
  }

  function formatMarketCap(token: Token): string {
    const marketCap =
      getCirculatingSupply(token) * parseFloat(getTokenPrice(token));
    return formatUsdCompact(marketCap);
  }

  function formatFdv(token: Token): string {
    const fdv = getTotalSupply(token) * parseFloat(getTokenPrice(token));
    return formatUsdCompact(fdv);
  }

  function formatPriceChange24h(token: Token): string {
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

  function getPriceChange24hDirection(token: Token): "up" | "down" | "flat" {
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

  function getLiquiditySeverity(token: Token): "low" | "medium" | "normal" {
    const liquidity = token.liquidity_usd;
    if (!Number.isFinite(liquidity)) return "normal";
    if (liquidity < 500) return "low";
    if (liquidity < 5000) return "medium";
    return "normal";
  }

  function getVolumeSeverity(token: Token): "low" | "normal" {
    const volume = token.volume_usd_24h;
    if (!Number.isFinite(volume)) return "normal";
    return volume < 500 ? "low" : "normal";
  }

  function handleTooltipMove(event: MouseEvent, token: Token) {
    if (Date.now() < hoverSuppressUntil) return;
    hoveredToken = token;
    tooltipX = event.clientX + 12;
    tooltipY = event.clientY + 12;
  }

  function handleTooltipLeave() {
    hoveredToken = null;
  }

  function handleTokenClick(token: Token) {
    if (longPressActive || mobileTooltipToken) {
      longPressActive = false;
      return;
    }
    handleSelectToken(token);
  }

  function handleTokenTouchStart(event: TouchEvent, token: Token) {
    if (!isMobile || !supportsTouch) return;
    event.preventDefault();
    longPressActive = false;
    const touch = event.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    if (longPressTimer) window.clearTimeout(longPressTimer);
    longPressTimer = window.setTimeout(() => {
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
  >
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      tabindex="-1"
      onclick={(e) => {
        e.stopPropagation();
        handleModalClick(e);
      }}
      onkeydown={(e) => e.stopPropagation()}
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
          type="text"
          placeholder="Search by ticker or address"
          bind:value={searchQuery}
        />
      </div>

      <div class="token-list" bind:this={scrollContainerRef}>
        {#if $tokenStore.isLoading || isSearching}
          <div class="loading">
            <div class="spinner"></div>
            <p>{isSearching ? "Searching..." : "Loading tokens..."}</p>
          </div>
        {:else if $tokenStore.error}
          <div class="error">
            <p>Failed to load tokens</p>
            <button onclick={() => tokenStore.fetchTokens()}>Retry</button>
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
                  <div class="token-icon-wrapper">
                    {#if getTokenIcon(token.account_id)}
                      <img
                        src={getTokenIcon(token.account_id)}
                        alt={token.metadata.symbol}
                        class="token-icon"
                      />
                    {:else}
                      <div class="token-icon-placeholder">
                        {token.metadata.symbol.charAt(0)}
                      </div>
                    {/if}
                    <TokenBadge {token} />
                  </div>
                  <div class="token-info">
                    <div class="token-symbol">{token.metadata.symbol}</div>
                    <div class="token-price-secondary">{formatPrice(token)}</div>
                  </div>
                </div>
                <div class="token-stats">
                  {#if formatBalance(token)}
                    <div class="token-balance-main">{formatBalance(token)}</div>
                  {/if}
                  {#if formatDollarBalance(token)}
                    <div class="token-balance-secondary">
                      Balance: {formatDollarBalance(token)}
                    </div>
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>
      {#if hoveredToken && (!isMobile || !supportsTouch)}
        <div
          class="token-tooltip token-tooltip-floating"
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

  .token-icon-wrapper {
    position: relative;
    flex-shrink: 0;
    width: 2.5rem;
    height: 2.5rem;
  }

  .token-icon {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    object-fit: cover;
    display: block;
  }

  .token-icon-placeholder {
    width: 2.5rem;
    height: 2.5rem;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent-primary), #2563eb);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 1rem;
    color: white;
  }

  /* Mobile: full-screen bottom sheet */
  @media (max-width: 640px) {
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

    .token-icon-wrapper {
      width: 2.25rem;
      height: 2.25rem;
    }

    .token-icon {
      width: 2.25rem;
      height: 2.25rem;
    }

    .token-icon-placeholder {
      width: 2.25rem;
      height: 2.25rem;
      font-size: 0.875rem;
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
    background: var(--accent-primary);
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

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border-color);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
