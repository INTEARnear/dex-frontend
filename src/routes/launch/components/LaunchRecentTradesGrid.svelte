<script lang="ts">
  import { flip } from "svelte/animate";
  import { Check, Copy, ExternalLink } from "lucide-svelte";
  import { onMount } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { tokenHubStore } from "../../../lib/tokenHubStore";
  import { formatCompact, formatRelativeDate } from "../../../lib/utils";
  import {
    DEFAULT_LAUNCH_TRADES_VIEWER_CONFIG,
    loadLaunchTradesViewerConfigWithMeta,
    saveLaunchTradesViewerConfig,
  } from "../launchTradesConfig";
  import type {
    LaunchTradeSwapEvent,
    LaunchTradesColumnKey,
    LaunchTradesColumnWidths,
    LaunchTradesViewerConfig,
    LaunchTradeType,
  } from "../types";

  const TRADE_EVENTS_API =
    "https://events-v3.intear.tech/v3/trade_swap/by_token_newest";
  const TRADE_EVENTS_WS = "wss://ws-events-v3.intear.tech/events/trade_swap";
  const PRICE_AT_TIME_API =
    "https://events-v3.intear.tech/v3/price_token/price_at_time";

  const COLUMN_ORDER: LaunchTradesColumnKey[] = [
    "time",
    "type",
    "amount",
    "trader",
    "txn",
  ];
  const MIN_COLUMN_WIDTH_PX: Record<LaunchTradesColumnKey, number> = {
    time: 108,
    type: 84,
    amount: 130,
    trader: 196,
    txn: 70,
  };
  const MAX_COLUMN_WIDTH_PX: Partial<Record<LaunchTradesColumnKey, number>> = {
    trader: 240,
    txn: 74,
  };

  const historicalPriceCache = new Map<string, number | null>();
  const historicalPriceInflight = new Map<string, Promise<number | null>>();

  interface Props {
    tokenAccountId: string;
  }

  let { tokenAccountId }: Props = $props();

  let trades = $state<LaunchTradeSwapEvent[]>([]);
  let usdByTradeKey = $state<Record<string, number | null>>({});
  let settings = $state<LaunchTradesViewerConfig>({
    ...DEFAULT_LAUNCH_TRADES_VIEWER_CONFIG,
    columnWidths: { ...DEFAULT_LAUNCH_TRADES_VIEWER_CONFIG.columnWidths },
  });

  let isLoading = $state(true);
  let loadError = $state<string | null>(null);
  let hasRestoredSettings = $state(false);
  let gridRef = $state<HTMLDivElement | null>(null);
  let copiedTradeKey = $state<string | null>(null);
  let relativeTimeTick = $state(0);
  let isResizing = $state(false);
  let shouldCapDefaultColumns = $state(false);
  let viewportWidth = $state(0);

  let currentSocket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let reconnectDelayMs = 1_500;
  let activeSocketEpoch = 0;
  let activeRequestId = 0;
  let activeTokenAccountId: string | null = null;
  let copyResetTimer: number | null = null;
  let relativeTickerTimer: number | null = null;
  let activeResizeCleanup: (() => void) | null = null;
  const usdInflightKeys = new Set<string>();

  const isSmallViewport = $derived(viewportWidth <= 480);

  const gridTemplateColumns = $derived.by(() => {
    const widths = isSmallViewport
      ? applyMobileColumnLayout(normalizeColumnWidths(settings.columnWidths))
      : settings.columnWidths;
    return `${widths.time}% ${widths.type}% ${widths.amount}% ${widths.trader}% ${widths.txn}%`;
  });

  $effect(() => {
    if (!shouldCapDefaultColumns) return;
    const gridWidthPx = gridRef?.getBoundingClientRect().width;
    if (!gridWidthPx || !Number.isFinite(gridWidthPx) || gridWidthPx <= 0)
      return;

    shouldCapDefaultColumns = false;
    const nextWidths = applyDefaultColumnCaps(
      settings.columnWidths,
      gridWidthPx,
    );
    if (!areColumnWidthsEqual(nextWidths, settings.columnWidths)) {
      updateAndPersistSettings({
        ...settings,
        columnWidths: nextWidths,
      });
    }
  });

  $effect(() => {
    const accountId = tokenAccountId;
    if (!accountId) return;
    if (accountId === activeTokenAccountId) return;
    activeTokenAccountId = accountId;

    const requestId = ++activeRequestId;
    isLoading = true;
    loadError = null;
    trades = [];
    usdByTradeKey = {};
    copiedTradeKey = null;
    usdInflightKeys.clear();

    tokenHubStore.ensureTokenById(accountId);
    tokenHubStore.ensureTokenById("usdt.tether-token.near");

    fetchInitialTrades(accountId, requestId);
    connectTradeSocket(accountId, requestId);
  });

  $effect(() => {
    const accountId = tokenAccountId;
    for (const trade of trades) {
      const tradeKey = trade.transaction_id;
      if (
        usdByTradeKey[tradeKey] !== undefined ||
        usdInflightKeys.has(tradeKey)
      ) {
        continue;
      }
      resolveTradeUsdValue(trade, accountId);
    }
  });

  onMount(() => {
    const loaded = loadLaunchTradesViewerConfigWithMeta();
    settings = loaded.config;
    shouldCapDefaultColumns = loaded.usedDefaultColumnWidths;
    hasRestoredSettings = true;
    viewportWidth = window.innerWidth;

    const handleResize = () => {
      viewportWidth = window.innerWidth;
    };
    window.addEventListener("resize", handleResize, { passive: true });

    relativeTickerTimer = window.setInterval(() => {
      relativeTimeTick += 1;
    }, 1_000);

    return () => {
      window.removeEventListener("resize", handleResize);
      activeTokenAccountId = null;
      disconnectTradeSocket();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (copyResetTimer !== null) window.clearTimeout(copyResetTimer);
      if (relativeTickerTimer !== null)
        window.clearInterval(relativeTickerTimer);
      activeResizeCleanup?.();
      activeResizeCleanup = null;
    };
  });

  function serializeBalanceChanges(
    balanceChanges: Record<string, string>,
  ): string {
    return Object.entries(balanceChanges)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([tokenId, amountRaw]) => `${tokenId}:${amountRaw}`)
      .join("|");
  }

  function compareTradesNewestFirst(
    left: LaunchTradeSwapEvent,
    right: LaunchTradeSwapEvent,
  ): number {
    const leftTimestamp = Number(left.block_timestamp_nanosec);
    const rightTimestamp = Number(right.block_timestamp_nanosec);
    if (leftTimestamp !== rightTimestamp) {
      return rightTimestamp - leftTimestamp;
    }
    if (left.block_height !== right.block_height) {
      return right.block_height - left.block_height;
    }
    return left.transaction_id.localeCompare(right.transaction_id);
  }

  function hasSelectedTokenChange(
    trade: LaunchTradeSwapEvent,
    selectedTokenId: string,
  ): boolean {
    return Number(trade.balance_changes[selectedTokenId]) !== 0;
  }

  function mergeTrades(nextTrades: LaunchTradeSwapEvent[]) {
    if (nextTrades.length === 0) return;

    const mergedByKey = new Map<string, LaunchTradeSwapEvent>();
    for (const trade of trades) {
      mergedByKey.set(trade.transaction_id, trade);
    }

    for (const trade of nextTrades) {
      if (!hasSelectedTokenChange(trade, tokenAccountId)) continue;
      mergedByKey.set(trade.transaction_id, trade);
    }

    trades = Array.from(mergedByKey.values()).sort(compareTradesNewestFirst);
  }

  async function fetchInitialTrades(
    accountId: string,
    requestId: number,
  ): Promise<void> {
    try {
      const response = await fetch(
        `${TRADE_EVENTS_API}?account=${encodeURIComponent(accountId)}`,
      );
      if (!response.ok) {
        throw new Error(
          `Failed to fetch recent trades: HTTP ${response.status}`,
        );
      }

      const payload = (await response.json()) as LaunchTradeSwapEvent[];
      if (requestId !== activeRequestId || accountId !== tokenAccountId) return;
      mergeTrades(payload);
      loadError = null;
    } catch (error) {
      if (requestId !== activeRequestId || accountId !== tokenAccountId) return;
      loadError =
        error instanceof Error
          ? error.message
          : "Failed to fetch recent trades";
    } finally {
      if (requestId !== activeRequestId || accountId !== tokenAccountId) return;
      isLoading = false;
    }
  }

  function disconnectTradeSocket() {
    activeSocketEpoch += 1;
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (currentSocket) {
      currentSocket.onopen = null;
      currentSocket.onmessage = null;
      currentSocket.onerror = null;
      currentSocket.onclose = null;
      currentSocket.close();
      currentSocket = null;
    }
  }

  function connectTradeSocket(accountId: string, requestId: number) {
    disconnectTradeSocket();
    reconnectDelayMs = 1_500;
    const socketEpoch = activeSocketEpoch;

    const connect = () => {
      if (
        requestId !== activeRequestId ||
        accountId !== tokenAccountId ||
        socketEpoch !== activeSocketEpoch
      ) {
        return;
      }

      const socket = new WebSocket(TRADE_EVENTS_WS);
      currentSocket = socket;

      socket.onopen = () => {
        reconnectDelayMs = 1_500;
        socket.send(
          JSON.stringify({
            And: [
              {
                path: "balance_changes",
                operator: { HasKey: accountId },
              },
            ],
          }),
        );
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as LaunchTradeSwapEvent[];
          mergeTrades(payload);
        } catch {
          // do nothing
        }
      };

      socket.onclose = () => {
        if (
          requestId !== activeRequestId ||
          accountId !== tokenAccountId ||
          socketEpoch !== activeSocketEpoch
        ) {
          return;
        }
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, reconnectDelayMs);
        reconnectDelayMs = Math.min(Math.floor(reconnectDelayMs * 1.8), 30_000);
      };
    };

    connect();
  }

  function getTradeType(trade: LaunchTradeSwapEvent): LaunchTradeType {
    return Number(trade.balance_changes[tokenAccountId]) > 0 ? "BUY" : "SELL";
  }

  function getCounterTokenChange(trade: LaunchTradeSwapEvent): {
    tokenId: string;
    amountRaw: string;
  } | null {
    let selected: {
      tokenId: string;
      amountRaw: string;
      absoluteAmount: number;
    } | null = null;

    for (const [tokenId, amountRaw] of Object.entries(trade.balance_changes)) {
      if (tokenId === tokenAccountId) continue;
      const parsed = Number(amountRaw);
      if (parsed === 0) continue;
      const absoluteAmount = Math.abs(parsed);
      if (!selected || absoluteAmount > selected.absoluteAmount) {
        selected = { tokenId, amountRaw, absoluteAmount };
      }
    }

    if (!selected) return null;
    return { tokenId: selected.tokenId, amountRaw: selected.amountRaw };
  }

  async function getTokenDecimals(tokenId: string): Promise<number | null> {
    const existing = tokenHubStore.selectToken(tokenId);
    if (existing) return existing.metadata.decimals;
    try {
      await tokenHubStore.ensureTokenById(tokenId);
    } catch {
      return null;
    }
    return tokenHubStore.selectToken(tokenId)?.metadata.decimals ?? null;
  }

  async function fetchHistoricalRawPrice(
    tokenId: string,
    timestampNanosec: string,
  ): Promise<number | null> {
    const cacheKey = `${tokenId}:${timestampNanosec}`;

    if (historicalPriceCache.has(cacheKey)) {
      return historicalPriceCache.get(cacheKey) ?? null;
    }

    const inflight = historicalPriceInflight.get(cacheKey);
    if (inflight) return inflight;

    const request = (async () => {
      try {
        const response = await fetch(
          `${PRICE_AT_TIME_API}?token=${encodeURIComponent(tokenId)}&timestamp_nanosec=${encodeURIComponent(timestampNanosec)}`,
        );
        if (!response.ok) return null;
        const payload = (await response.json()) as {
          price_usd?: number | string;
        };
        const rawPrice =
          typeof payload.price_usd === "number"
            ? payload.price_usd
            : Number(payload.price_usd);
        if (!Number.isFinite(rawPrice) || rawPrice < 0) return null;
        return rawPrice;
      } catch {
        return null;
      } finally {
        historicalPriceInflight.delete(cacheKey);
      }
    })();

    historicalPriceInflight.set(cacheKey, request);
    const resolvedPrice = await request;
    historicalPriceCache.set(cacheKey, resolvedPrice);
    return resolvedPrice;
  }

  async function computeTradeUsdValue(
    trade: LaunchTradeSwapEvent,
  ): Promise<number | null> {
    const counterTokenChange = getCounterTokenChange(trade);
    if (!counterTokenChange) return null;

    const parsedCounterAmount = Number(counterTokenChange.amountRaw);
    if (parsedCounterAmount === 0) return null;
    const absoluteCounterAmount = Math.abs(parsedCounterAmount);

    const counterTokenId = counterTokenChange.tokenId;
    const priceTokenId =
      counterTokenId === "near" ? "wrap.near" : counterTokenId;

    const [counterTokenDecimals, usdtDecimals, rawPriceUsd] = await Promise.all(
      [
        getTokenDecimals(counterTokenId),
        getTokenDecimals("usdt.tether-token.near"),
        fetchHistoricalRawPrice(priceTokenId, trade.block_timestamp_nanosec),
      ],
    );

    if (
      counterTokenDecimals === null ||
      usdtDecimals === null ||
      rawPriceUsd === null
    ) {
      return null;
    }

    const counterAmountHuman =
      absoluteCounterAmount / Math.pow(10, counterTokenDecimals);
    if (!Number.isFinite(counterAmountHuman)) return null;

    const humanReadablePriceUsd =
      (rawPriceUsd * Math.pow(10, counterTokenDecimals)) /
      Math.pow(10, usdtDecimals);
    if (!Number.isFinite(humanReadablePriceUsd) || humanReadablePriceUsd < 0) {
      return null;
    }

    const usdValue = counterAmountHuman * humanReadablePriceUsd;
    if (!Number.isFinite(usdValue) || usdValue < 0) return null;
    return usdValue;
  }

  async function resolveTradeUsdValue(
    trade: LaunchTradeSwapEvent,
    accountId: string,
  ): Promise<void> {
    const tradeKey = trade.transaction_id;
    if (usdInflightKeys.has(tradeKey)) return;
    usdInflightKeys.add(tradeKey);

    const usdValue = await computeTradeUsdValue(trade);
    usdInflightKeys.delete(tradeKey);

    if (accountId !== tokenAccountId) return;
    usdByTradeKey = {
      ...usdByTradeKey,
      [tradeKey]: usdValue,
    };
  }

  function formatUsdAmount(usdValue: number | null | undefined): string {
    if (usdValue === undefined) return "…";
    if (usdValue === null) return "N/A";
    if (usdValue < 0.01) return "<$0.01";
    if (usdValue < 1_000) return `$${usdValue.toFixed(2)}`;
    if (usdValue < 1_000_000) return `$${formatCompact(usdValue / 1_000)}K`;
    if (usdValue < 1_000_000_000)
      return `$${formatCompact(usdValue / 1_000_000)}M`;
    if (usdValue < 1_000_000_000_000) {
      return `$${formatCompact(usdValue / 1_000_000_000)}B`;
    }
    return `$${formatCompact(usdValue / 1_000_000_000_000)}T`;
  }

  function formatTradeTime(timestampNanosec: string): string {
    const date = new Date(Number(timestampNanosec) / 1_000_000);
    if (settings.timeMode === "relative") {
      void relativeTimeTick;
      return formatRelativeDate(date);
    }

    const now = new Date();
    const isSameDay =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();

    if (isSameDay) {
      return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    }

    return date.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function buildTraderLink(accountId: string): string {
    return settings.traderExplorer === "nearblocks"
      ? `https://nearblocks.io/address/${accountId}`
      : `https://pikespeak.ai/wallet-explorer/${accountId}`;
  }

  function buildTxnLink(transactionId: string): string {
    return settings.txnExplorer === "nearblocks"
      ? `https://nearblocks.io/txns/${transactionId}`
      : `https://pikespeak.ai/transaction-viewer/${transactionId}`;
  }

  function updateAndPersistSettings(
    nextSettings: LaunchTradesViewerConfig,
  ) {
    settings = nextSettings;
    if (hasRestoredSettings) {
      saveLaunchTradesViewerConfig(nextSettings);
    }
  }

  function toggleTimeMode() {
    updateAndPersistSettings({
      ...settings,
      timeMode: settings.timeMode === "relative" ? "absolute" : "relative",
    });
  }

  function toggleTraderExplorer() {
    updateAndPersistSettings({
      ...settings,
      traderExplorer:
        settings.traderExplorer === "nearblocks" ? "pikespeak" : "nearblocks",
    });
  }

  function toggleTxnExplorer() {
    updateAndPersistSettings({
      ...settings,
      txnExplorer:
        settings.txnExplorer === "nearblocks" ? "pikespeak" : "nearblocks",
    });
  }

  function normalizeColumnWidths(
    widths: LaunchTradesColumnWidths,
  ): LaunchTradesColumnWidths {
    const total =
      widths.time + widths.type + widths.amount + widths.trader + widths.txn;
    if (!Number.isFinite(total) || total <= 0) return settings.columnWidths;
    return {
      time: (widths.time / total) * 100,
      type: (widths.type / total) * 100,
      amount: (widths.amount / total) * 100,
      trader: (widths.trader / total) * 100,
      txn: (widths.txn / total) * 100,
    };
  }

  function applyMobileColumnLayout(
    widths: LaunchTradesColumnWidths,
  ): LaunchTradesColumnWidths {
    const distributionKeys: Array<keyof LaunchTradesColumnWidths> = [
      "time",
      "type",
      "amount",
      "trader",
      "txn",
    ];
    const distributionBase = distributionKeys.reduce(
      (sum, key) => sum + widths[key],
      0,
    );

    const adjusted: LaunchTradesColumnWidths = {
      ...widths,
    };
    for (const key of distributionKeys) {
      adjusted[key] += widths[key] / distributionBase;
    }

    return normalizeColumnWidths(adjusted);
  }

  function applyDefaultColumnCaps(
    widths: LaunchTradesColumnWidths,
    gridWidthPx: number,
  ): LaunchTradesColumnWidths {
    const normalized = normalizeColumnWidths(widths);

    const px: LaunchTradesColumnWidths = {
      time: (normalized.time / 100) * gridWidthPx,
      type: (normalized.type / 100) * gridWidthPx,
      amount: (normalized.amount / 100) * gridWidthPx,
      trader: (normalized.trader / 100) * gridWidthPx,
      txn: (normalized.txn / 100) * gridWidthPx,
    };

    let freedPx = 0;
    for (const key of ["trader", "txn"] as (keyof LaunchTradesColumnWidths)[]) {
      const maxPx = MAX_COLUMN_WIDTH_PX[key]!;
      if (px[key] > maxPx) {
        freedPx += px[key] - maxPx;
        px[key] = maxPx;
      }
    }

    if (freedPx > 0) {
      const distributeKeys: Array<keyof LaunchTradesColumnWidths> = [
        "time",
        "type",
        "amount",
      ];
      const distributeBase = distributeKeys.reduce(
        (sum, key) => sum + px[key],
        0,
      );
      if (distributeBase > 0) {
        for (const key of distributeKeys) {
          px[key] += (freedPx * px[key]) / distributeBase;
        }
      } else {
        const split = freedPx / distributeKeys.length;
        for (const key of distributeKeys) {
          px[key] += split;
        }
      }
    }

    const pxTotal = px.time + px.type + px.amount + px.trader + px.txn;
    return {
      time: (px.time / pxTotal) * 100,
      type: (px.type / pxTotal) * 100,
      amount: (px.amount / pxTotal) * 100,
      trader: (px.trader / pxTotal) * 100,
      txn: (px.txn / pxTotal) * 100,
    };
  }

  function areColumnWidthsEqual(
    left: LaunchTradesColumnWidths,
    right: LaunchTradesColumnWidths,
  ): boolean {
    return (
      Math.abs(left.time - right.time) < 0.0001 &&
      Math.abs(left.type - right.type) < 0.0001 &&
      Math.abs(left.amount - right.amount) < 0.0001 &&
      Math.abs(left.trader - right.trader) < 0.0001 &&
      Math.abs(left.txn - right.txn) < 0.0001
    );
  }

  function startColumnResize(event: PointerEvent, boundaryIndex: number) {
    if (isSmallViewport) return;
    if (!gridRef) return;

    activeResizeCleanup?.();
    activeResizeCleanup = null;
    event.preventDefault();

    const leftKey = COLUMN_ORDER[boundaryIndex];
    const rightKey = COLUMN_ORDER[boundaryIndex + 1];
    if (!leftKey || !rightKey) return;

    const gridWidthPx = gridRef.getBoundingClientRect().width;
    if (!Number.isFinite(gridWidthPx) || gridWidthPx <= 0) return;

    const startX = event.clientX;
    const startWidths = { ...settings.columnWidths };
    const startLeftPx = (startWidths[leftKey] / 100) * gridWidthPx;
    const startRightPx = (startWidths[rightKey] / 100) * gridWidthPx;
    const minLeftPx = MIN_COLUMN_WIDTH_PX[leftKey];
    const minRightPx = MIN_COLUMN_WIDTH_PX[rightKey];

    isResizing = true;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaPx = moveEvent.clientX - startX;
      const combinedPx = startLeftPx + startRightPx;

      let nextLeftPx = startLeftPx + deltaPx;
      nextLeftPx = Math.max(
        minLeftPx,
        Math.min(combinedPx - minRightPx, nextLeftPx),
      );
      const nextRightPx = combinedPx - nextLeftPx;

      if (nextLeftPx < minLeftPx || nextRightPx < minRightPx) {
        return;
      }

      const nextWidths: LaunchTradesColumnWidths = {
        ...startWidths,
        [leftKey]: (nextLeftPx / gridWidthPx) * 100,
        [rightKey]: (nextRightPx / gridWidthPx) * 100,
      };

      settings = {
        ...settings,
        columnWidths: normalizeColumnWidths(nextWidths),
      };
    };

    const stopResize = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResize);
      activeResizeCleanup = null;
      isResizing = false;
      if (hasRestoredSettings) {
        saveLaunchTradesViewerConfig(settings);
      }
    };

    activeResizeCleanup = stopResize;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResize);
  }

  async function copyTraderAccount(
    tradeKey: string,
    accountId: string,
  ): Promise<void> {
    await navigator.clipboard.writeText(accountId);
    copiedTradeKey = tradeKey;
    if (copyResetTimer !== null) window.clearTimeout(copyResetTimer);
    copyResetTimer = window.setTimeout(() => {
      copiedTradeKey = null;
      copyResetTimer = null;
    }, 2_000);
  }

  async function retryFetch(): Promise<void> {
    const requestId = activeRequestId;
    isLoading = true;
    loadError = null;
    await fetchInitialTrades(tokenAccountId, requestId);
  }
</script>

<section class="recent-trades-card" class:is-resizing={isResizing}>
  <div class="recent-trades-title-row">
    <h3>Recent Trades</h3>
    {#if loadError}
      <button type="button" class="retry-btn" onclick={retryFetch}>
        Retry
      </button>
    {/if}
  </div>

  {#if loadError}
    <p class="trades-error">{loadError}</p>
  {/if}

  <div class="table-scroll">
    <div
      class="trades-grid"
      bind:this={gridRef}
      style={`--launch-trades-columns: ${gridTemplateColumns};`}
    >
      <div class="trade-header trade-grid">
        <div class="header-cell">
          <span>Time</span>
          <button
            type="button"
            class="header-icon-btn"
            onclick={toggleTimeMode}
            aria-label="Toggle time format"
            title={settings.timeMode === "relative"
              ? "Relative time (click to switch to absolute)"
              : "Absolute time (click to switch to relative)"}
          >
            {#if settings.timeMode === "relative"}
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9"></circle>
                <path d="M12 7v5l3 2"></path>
              </svg>
            {:else}
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="4" width="18" height="18" rx="2"></rect>
                <path d="M16 2v4"></path>
                <path d="M8 2v4"></path>
                <path d="M3 10h18"></path>
              </svg>
            {/if}
          </button>
          <button
            type="button"
            class="column-resizer"
            aria-label="Resize Time and Type columns"
            onpointerdown={(event) => startColumnResize(event, 0)}
          ></button>
        </div>

        <div class="header-cell">
          <span>Type</span>
          <button
            type="button"
            class="column-resizer"
            aria-label="Resize Type and Amount columns"
            onpointerdown={(event) => startColumnResize(event, 1)}
          ></button>
        </div>

        <div class="header-cell">
          <span>Amount</span>
          <button
            type="button"
            class="column-resizer"
            aria-label="Resize Amount and Trader columns"
            onpointerdown={(event) => startColumnResize(event, 2)}
          ></button>
        </div>

        <div class="header-cell">
          <span>Trader</span>
          <button
            type="button"
            class="header-source-btn"
            onclick={toggleTraderExplorer}
            aria-label="Toggle trader explorer"
            title={settings.traderExplorer === "nearblocks"
              ? "Nearblocks trader links enabled"
              : "Pikespeak trader links enabled"}
          >
            {isSmallViewport
              ? settings.traderExplorer === "nearblocks"
                ? "NB"
                : "PP"
              : settings.traderExplorer === "nearblocks"
                ? "Nearblocks"
                : "Pikespeak"}
          </button>
          <button
            type="button"
            class="column-resizer"
            aria-label="Resize Trader and Txn columns"
            onpointerdown={(event) => startColumnResize(event, 3)}
          ></button>
        </div>

        <div class="header-cell header-cell-last">
          <span>Txn</span>
          <button
            type="button"
            class="header-source-btn"
            onclick={toggleTxnExplorer}
            aria-label="Toggle transaction explorer"
            title={settings.txnExplorer === "nearblocks"
              ? "Nearblocks transaction links enabled"
              : "Pikespeak transaction links enabled"}
          >
            {settings.txnExplorer === "nearblocks" ? "NB" : "PP"}
          </button>
        </div>
      </div>

      {#if isLoading && trades.length === 0}
        <div class="table-state">Loading recent trades...</div>
      {:else if trades.length === 0}
        <div class="table-state">No recent trades yet.</div>
      {:else}
        <div class="trade-body">
          {#each trades as trade (trade.transaction_id)}
            {@const tradeType = getTradeType(trade)}
            {@const tradeKey = trade.transaction_id}
            <article
              class="trade-row trade-grid"
              class:buy={tradeType === "BUY"}
              class:sell={tradeType === "SELL"}
              animate:flip={{ duration: 180, easing: cubicOut }}
            >
              <div class="trade-cell time-cell neutral-cell">
                {formatTradeTime(trade.block_timestamp_nanosec)}
              </div>
              <div class="trade-cell type-cell">{tradeType}</div>
              <div class="trade-cell amount-cell">
                {formatUsdAmount(usdByTradeKey[tradeKey])}
              </div>
              <div class="trade-cell trader-cell neutral-cell">
                <a
                  href={buildTraderLink(trade.trader)}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="trader-link"
                  title={trade.trader}
                >
                  {trade.trader}
                </a>
                <button
                  type="button"
                  class="copy-btn"
                  class:copied={copiedTradeKey === tradeKey}
                  onclick={() => copyTraderAccount(tradeKey, trade.trader)}
                  aria-label={`Copy trader account ${trade.trader}`}
                  title="Copy account id"
                >
                  {#if copiedTradeKey === tradeKey}
                    <Check size={17} strokeWidth={2.25} />
                  {:else}
                    <Copy size={17} strokeWidth={2} />
                  {/if}
                </button>
              </div>
              <div class="trade-cell txn-cell neutral-cell">
                <a
                  href={buildTxnLink(trade.transaction_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="txn-link"
                  title={trade.transaction_id}
                  aria-label={`Open transaction ${trade.transaction_id}`}
                >
                  <ExternalLink size={17} strokeWidth={2.1} />
                </a>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</section>

<style>
  .recent-trades-card {
    width: 100%;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 1rem;
    padding: 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .recent-trades-card.is-resizing {
    user-select: none;
  }

  .recent-trades-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .recent-trades-title-row h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: 1rem;
    font-weight: 700;
  }

  .retry-btn {
    border: 1px solid var(--border-color);
    border-radius: 0.45rem;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.75rem;
    font-weight: 600;
    padding: 0.25rem 0.45rem;
    cursor: pointer;
    transition:
      border-color 0.2s ease,
      color 0.2s ease,
      background 0.2s ease;
  }

  .retry-btn:hover {
    border-color: var(--accent-primary);
    color: var(--text-primary);
    background: var(--bg-input);
  }

  .trades-error {
    margin: 0;
    color: var(--status-error-text);
    font-size: 0.8rem;
    line-height: 1.4;
  }

  .table-scroll {
    width: 100%;
    overflow-x: auto;
  }

  .trades-grid {
    min-width: 440px;
    width: 100%;
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
    overflow: hidden;
    background: color-mix(in oklab, var(--bg-card), var(--bg-input) 25%);
  }

  .trade-grid {
    display: grid;
    grid-template-columns: var(--launch-trades-columns);
    align-items: center;
  }

  .trade-header {
    border-bottom: 1px solid var(--border-color);
    background: color-mix(in oklab, var(--bg-input), var(--bg-card) 40%);
  }

  .header-cell {
    min-width: 0;
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.36rem;
    padding: 0.55rem 0.66rem;
    color: var(--text-secondary);
    font-size: 0.74rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-family: "JetBrains Mono", monospace;
  }

  .header-cell-last {
    justify-content: flex-end;
  }

  .header-icon-btn,
  .header-source-btn {
    border: 1px solid var(--border-color);
    border-radius: 0.38rem;
    background: transparent;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.35rem;
    height: 1.35rem;
    cursor: pointer;
    transition:
      border-color 0.2s ease,
      color 0.2s ease,
      background 0.2s ease;
  }

  .header-source-btn {
    width: auto;
    min-width: 1.65rem;
    padding: 0 0.28rem;
    font-size: 0.67rem;
    font-weight: 700;
    font-family: "JetBrains Mono", monospace;
  }

  .header-icon-btn:hover,
  .header-source-btn:hover {
    border-color: var(--accent-primary);
    color: var(--text-primary);
    background: var(--bg-card);
  }

  .column-resizer {
    position: absolute;
    top: 0;
    right: -4px;
    width: 9px;
    height: 100%;
    border: none;
    margin: 0;
    padding: 0;
    background: transparent;
    cursor: col-resize;
    z-index: 2;
  }

  .column-resizer::before {
    content: "";
    position: absolute;
    left: 3px;
    top: 18%;
    bottom: 18%;
    width: 1px;
    background: color-mix(in oklab, var(--border-color), transparent 40%);
    transition: background 0.15s ease;
  }

  .column-resizer:hover::before {
    background: var(--accent-primary);
  }

  .trade-body {
    width: 100%;
  }

  .trade-row {
    min-width: 0;
    border-bottom: 1px solid
      color-mix(in oklab, var(--border-color), transparent 35%);
    color: var(--text-secondary);
    transition: background-color 0.16s ease;
  }

  .trade-row:last-child {
    border-bottom: none;
  }

  .trade-row:hover {
    background: color-mix(in oklab, var(--bg-card), var(--bg-input) 35%);
  }

  .trade-row.buy {
    color: var(--status-success-text);
  }

  .trade-row.sell {
    color: var(--status-error-text);
  }

  .trade-cell {
    min-width: 0;
    padding: 0.58rem 0.66rem;
    font-size: 0.82rem;
    line-height: 1.2;
  }

  .type-cell,
  .amount-cell {
    font-family: "JetBrains Mono", monospace;
    font-weight: 600;
  }

  .neutral-cell {
    color: var(--text-secondary);
  }

  .time-cell {
    font-family: "JetBrains Mono", monospace;
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .trader-cell {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .trader-link {
    min-width: 0;
    flex: 1;
    color: inherit;
    text-decoration: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: "JetBrains Mono", monospace;
    font-size: 0.78rem;
  }

  .trader-link:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .copy-btn {
    flex-shrink: 0;
    border: none;
    border-radius: 0.38rem;
    width: 1.5rem;
    height: 1.5rem;
    background: transparent;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition:
      border-color 0.2s ease,
      color 0.2s ease,
      background 0.2s ease;
  }

  .copy-btn:hover {
    color: var(--text-primary);
    background: var(--bg-input);
  }

  .copy-btn.copied {
    color: var(--status-success-text);
  }

  .txn-cell {
    display: flex;
    justify-content: center;
  }

  .txn-link {
    border: none;
    border-radius: 0.38rem;
    width: 1.5rem;
    height: 1.5rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    text-decoration: none;
    transition:
      border-color 0.2s ease,
      color 0.2s ease,
      background 0.2s ease;
  }

  .txn-link:hover {
    color: var(--text-primary);
    background: var(--bg-input);
  }

  .table-state {
    padding: 0.9rem;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.85rem;
  }

  @media (--tablet) {
    .recent-trades-card {
      padding: 0.78rem;
    }
  }

  @media (--mobile) {
    .column-resizer {
      display: none;
    }

    .header-cell,
    .trade-cell {
      padding-left: 0.5rem;
      padding-right: 0.5rem;
    }

    .header-cell {
      font-size: 0.7rem;
    }

    .trade-cell {
      font-size: 0.78rem;
    }
  }
</style>
