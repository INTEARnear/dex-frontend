<script lang="ts">
  import { flip } from "svelte/animate";
  import { Check, Copy, ExternalLink, Funnel, X } from "lucide-svelte";
  import { onMount } from "svelte";
  import { cubicOut } from "svelte/easing";
  import { fade, fly } from "svelte/transition";
  import { focusFirstElement, trapFocusKeydown } from "$lib/a11y";
  import { tokenHubStore } from "$lib/tokenHubStore";
  import { formatCompact, formatRelativeDate } from "$lib/utils";
  import {
    DEFAULT_LAUNCH_TRADES_VIEWER_CONFIG,
    loadLaunchTradesViewerConfigWithMeta,
    saveLaunchTradesViewerConfig,
  } from "./launch/launchTradesConfig";
  import type {
    LaunchTradeHistoricalResponse,
    LaunchTradeHistorical,
    LaunchTradeSwapEvent,
    LaunchTradeChartMarker,
    LaunchTradesColumnKey,
    LaunchTradesExplorer,
    LaunchTradesColumnWidths,
    LaunchTradesViewerConfig,
    LaunchTradeType,
  } from "./launch/types";

  const TRADE_EVENTS_API =
    "https://prices.intear.tech/trades";
  const TRADE_EVENTS_WS = "wss://ws-events-v3.intear.tech/events/trade_swap";
  const PRICE_AT_TIME_API =
    "https://prices.intear.tech/price_at_time";

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
    time: 100,
    type: 100,
    txn: 74,
  };
  const USD_THRESHOLDS = [10, 50, 100, 500, 1_000, 5_000, 10_000] as const;
  type TradeSideFilter = "both" | "buy" | "sell";
  type FilterModal = "time" | "amount" | "trader" | null;

  const historicalPriceCache = new Map<string, number | null>();
  const historicalPriceInflight = new Map<string, Promise<number | null>>();

  interface Props {
    tokenAccountId: string;
    onTraderFilterChange?: (trader: string | null) => void;
    onTraderTradesChange?: (trades: LaunchTradeChartMarker[]) => void;
  }

  let {
    tokenAccountId,
    onTraderFilterChange,
    onTraderTradesChange,
  }: Props = $props();

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
  let sideFilter = $state<TradeSideFilter>("both");
  let minUsdFilter = $state<number | null>(null);
  let traderFilter = $state("");
  let filterModal = $state<FilterModal>(null);
  let filterModalRef = $state<HTMLDivElement | null>(null);
  let previouslyFocusedElement: HTMLElement | null = null;
  let draftMinUsd = $state<number | null>(null);
  let draftTrader = $state("");
  let afterMillisFilter = $state<number | null>(null);
  let beforeMillisFilter = $state<number | null>(null);
  let draftAfterTime = $state("");
  let draftBeforeTime = $state("");
  let nextCursor = $state<string | null>(null);
  let isLoadingMore = $state(false);

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

  // The REST endpoint applies all active filters. Keeping the previous page visible
  // until its replacement arrives prevents the document from collapsing and scrolling.
  const filteredTrades = $derived(trades);
  let lastPublishedChartTrades = "";

  $effect(() => {
    const trader = traderFilter;
    const chartTrades: LaunchTradeChartMarker[] = trader
      ? trades
          .filter((trade) => trade.trader === trader)
          .map((trade) => ({
            side:
              Number(trade.balance_changes[tokenAccountId]) > 0 ? "buy" : "sell",
            timestampMillis:
              Number(trade.block_timestamp_nanosec) / 1_000_000,
            transactionId: trade.transaction_id,
            usdValue: usdByTradeKey[trade.transaction_id],
          }))
      : [];
    const signature = chartTrades
      .map(
        (trade) =>
          `${trade.transactionId}:${trade.side}:${trade.timestampMillis}:${trade.usdValue}`,
      )
      .join("|");
    if (signature === lastPublishedChartTrades) return;

    lastPublishedChartTrades = signature;
    onTraderTradesChange?.(chartTrades);
  });

  const gridTemplateColumns = $derived.by(() => {
    const widths = settings.columnWidths;
    return `${widths.time}% ${widths.type}% ${widths.amount}% ${widths.trader}% ${widths.txn}%`;
  });

  $effect(() => {
    if (!shouldCapDefaultColumns) return;
    const gridWidthPx = gridRef?.getBoundingClientRect().width;
    if (!gridWidthPx)
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
    if (tokenAccountId === activeTokenAccountId) return;
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

    nextCursor = null;
    fetchTrades(accountId, requestId, false);
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

    relativeTickerTimer = setInterval(() => {
      relativeTimeTick += 1;
    }, 1_000);

    return () => {
      activeTokenAccountId = null;
      disconnectTradeSocket();
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (copyResetTimer !== null) clearTimeout(copyResetTimer);
      if (relativeTickerTimer !== null) clearInterval(relativeTickerTimer);
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
    if (!nextTrades?.length) return;

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

  function mapApiTradeToSwapEvent(
    apiTrade: LaunchTradeHistorical,
  ): LaunchTradeSwapEvent {
    return {
      balance_changes: {
        [apiTrade.token_in]: `-${apiTrade.amount_in}`,
        [apiTrade.token_out]: apiTrade.amount_out,
      },
      block_height: apiTrade.height,
      block_timestamp_nanosec: String(apiTrade.timestamp_millis * 1_000_000),
      receipt_id: apiTrade.receipt_id,
      trader: apiTrade.trader,
      transaction_id: apiTrade.transaction_id,
    };
  }

  function buildTradesUrl(accountId: string, cursor: string | null): string {
    const params = new URLSearchParams({
      token: accountId,
      order: "newest",
      limit: "50",
    });
    if (sideFilter !== "both") params.set("side", sideFilter);
    if (traderFilter) params.set("trader", traderFilter);
    if (minUsdFilter !== null) params.set("min_usd", String(minUsdFilter));
    if (afterMillisFilter !== null) params.set("after_millis", String(afterMillisFilter));
    if (beforeMillisFilter !== null) params.set("before_millis", String(beforeMillisFilter));
    if (cursor) params.set("cursor", cursor);
    return `${TRADE_EVENTS_API}?${params.toString()}`;
  }

  async function fetchTrades(
    accountId: string,
    requestId: number,
    append: boolean,
  ): Promise<void> {
    if (append) isLoadingMore = true;
    try {
      const response = await fetch(buildTradesUrl(accountId, append ? nextCursor : null));
      if (!response.ok) {
        throw new Error(
          `Failed to fetch recent trades: HTTP ${response.status}`,
        );
      }

      const payload = (await response.json()) as LaunchTradeHistoricalResponse;
      if (requestId !== activeRequestId || activeTokenAccountId !== tokenAccountId)
        return;
      if (!append) trades = [];
      mergeTrades(payload.trades.map(mapApiTradeToSwapEvent));
      nextCursor = payload.next_cursor ?? null;

      const usdUpdates: Record<string, number | null> = {};
      for (const historicalTrade of payload.trades) {
        if (historicalTrade.usd_value != null) {
          usdUpdates[historicalTrade.transaction_id] = Number(historicalTrade.usd_value);
        }
      }
      if (Object.keys(usdUpdates).length > 0) {
        usdByTradeKey = { ...usdByTradeKey, ...usdUpdates };
      }

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
      isLoadingMore = false;
    }
  }

  function matchesActiveFilters(trade: LaunchTradeSwapEvent): boolean {
    if (sideFilter !== "both" && getTradeType(trade).toLowerCase() !== sideFilter)
      return false;
    if (traderFilter && trade.trader !== traderFilter) return false;
    const timestampMillis = Number(trade.block_timestamp_nanosec) / 1000000;
    if (afterMillisFilter !== null && timestampMillis <= afterMillisFilter) return false;
    if (beforeMillisFilter !== null && timestampMillis >= beforeMillisFilter) return false;
    return true;
  }

  async function resetAndFetchTrades(): Promise<void> {
    const requestId = ++activeRequestId;
    isLoading = true;
    loadError = null;
    nextCursor = null;
    disconnectTradeSocket();
    await fetchTrades(tokenAccountId, requestId, false);
    connectTradeSocket(tokenAccountId, requestId);
  }

  async function loadNextPage(): Promise<void> {
    if (!nextCursor || isLoading || isLoadingMore) return;
    await fetchTrades(tokenAccountId, activeRequestId, true);
  }

  function paginationSentinel(node: HTMLElement, enabled: boolean) {
    let observer: IntersectionObserver | null = null;
    const observe = (shouldObserve: boolean) => {
      observer?.disconnect();
      observer = null;
      if (!shouldObserve) return;
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadNextPage();
      }, { rootMargin: "160px 0px" });
      observer.observe(node);
    };
    observe(enabled);
    return {
      update: observe,
      destroy: () => observer?.disconnect(),
    };
  }

  function cycleSideFilter(): void {
    switch (sideFilter) {
      case "both":
        sideFilter = "buy";
        break;
      case "buy":
        sideFilter = "sell";
        break;
      case "sell":
        sideFilter = "both";
        break;
    }
    resetAndFetchTrades();
  }

  function toDateTimeLocal(timestamp: number | null): string {
    if (timestamp === null) return "";
    const date = new Date(timestamp);
    const localDate = new Date(timestamp - date.getTimezoneOffset() * 60_000);
    return localDate.toISOString().slice(0, 16);
  }

  function openFilterModal(kind: Exclude<FilterModal, null>): void {
    draftMinUsd = minUsdFilter;
    draftTrader = traderFilter;
    draftAfterTime = toDateTimeLocal(afterMillisFilter);
    draftBeforeTime = toDateTimeLocal(beforeMillisFilter);
    filterModal = kind;
  }

  function closeFilterModal(): void {
    filterModal = null;
  }

  function handleFilterModalKeydown(event: KeyboardEvent): void {
    if (!filterModalRef) return;

    if (event.key === "Escape") {
      event.stopPropagation();
      closeFilterModal();
      return;
    }

    trapFocusKeydown(event, filterModalRef);
  }

  $effect(() => {
    if (!filterModal) return;

    previouslyFocusedElement =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    queueMicrotask(() => {
      if (filterModalRef) focusFirstElement(filterModalRef);
    });

    return () => {
      previouslyFocusedElement?.focus();
      previouslyFocusedElement = null;
    };
  });

  function setTraderFilter(trader: string): void {
    traderFilter = trader;
    onTraderFilterChange?.(trader || null);
  }

  function applyFilterModal(): void {
    minUsdFilter = draftMinUsd;
    setTraderFilter(draftTrader.trim());
    afterMillisFilter = draftAfterTime ? new Date(draftAfterTime).getTime() : null;
    beforeMillisFilter = draftBeforeTime ? new Date(draftBeforeTime).getTime() : null;
    closeFilterModal();
    resetAndFetchTrades();
  }

  function toggleTraderFilter(trader: string): void {
    setTraderFilter(traderFilter === trader ? "" : trader);
    resetAndFetchTrades();
  }

  function disconnectTradeSocket() {
    activeSocketEpoch += 1;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
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
          mergeTrades(payload.filter(matchesActiveFilters));
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
        reconnectTimer = setTimeout(() => {
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

  async function fetchHistoricalPrice(
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
          `${PRICE_AT_TIME_API}?token=${tokenId}&timestamp_millis=${Math.floor(Number(timestampNanosec) / 1000000)}`,
        );
        if (!response.ok) return null;
        const payload = (await response.json()) as {
          price_usd: string;
        };
        const rawPrice = Number(payload.price_usd);
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

    const [counterTokenDecimals, usdtDecimals, priceUsd] = await Promise.all(
      [
        getTokenDecimals(counterTokenId),
        getTokenDecimals("usdt.tether-token.near"),
        fetchHistoricalPrice(priceTokenId, trade.block_timestamp_nanosec),
      ],
    );

    if (
      counterTokenDecimals === null ||
      usdtDecimals === null ||
      priceUsd === null
    ) {
      return null;
    }

    const counterAmountHuman =
      absoluteCounterAmount / Math.pow(10, counterTokenDecimals);

    const usdValue = counterAmountHuman * priceUsd;
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

  function formatTradeTime(timestampMillis: number): string {
    const date = new Date(timestampMillis);
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

  function getExplorerLabel(explorer: LaunchTradesExplorer): string {
    if (explorer === "nearblocks") return "NearBlocks";
    if (explorer === "pikespeak") return "Pikespeak";
    return "NEAR Rocks";
  }

  function getExplorerAbbreviation(explorer: LaunchTradesExplorer): string {
    if (explorer === "nearblocks") return "NB";
    if (explorer === "pikespeak") return "PP";
    return "NR";
  }

  function getNextExplorer(
    explorer: LaunchTradesExplorer,
  ): LaunchTradesExplorer {
    if (explorer === "nearblocks") return "pikespeak";
    if (explorer === "pikespeak") return "nearrocks";
    return "nearblocks";
  }

  function buildTraderLink(accountId: string): string {
    if (settings.traderExplorer === "nearblocks") {
      return `https://nearblocks.io/address/${accountId}`;
    }
    if (settings.traderExplorer === "pikespeak") {
      return `https://pikespeak.ai/wallet-explorer/${accountId}`;
    }
    return `https://near.rocks/account/${accountId}`;
  }

  function buildTxnLink(transactionId: string): string {
    if (settings.txnExplorer === "nearblocks") {
      return `https://nearblocks.io/txns/${transactionId}`;
    }
    if (settings.txnExplorer === "pikespeak") {
      return `https://pikespeak.ai/transaction-viewer/${transactionId}`;
    }
    return `https://near.rocks/tx/${transactionId}`;
  }

  function updateAndPersistSettings(nextSettings: LaunchTradesViewerConfig) {
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
      traderExplorer: getNextExplorer(settings.traderExplorer),
    });
  }

  function toggleTxnExplorer() {
    updateAndPersistSettings({
      ...settings,
      txnExplorer: getNextExplorer(settings.txnExplorer),
    });
  }

  function normalizeColumnWidths(
    widths: LaunchTradesColumnWidths,
  ): LaunchTradesColumnWidths {
    const total =
      widths.time + widths.type + widths.amount + widths.trader + widths.txn;
    if (total === 0) return settings.columnWidths;
    return {
      time: (widths.time / total) * 100,
      type: (widths.type / total) * 100,
      amount: (widths.amount / total) * 100,
      trader: (widths.trader / total) * 100,
      txn: (widths.txn / total) * 100,
    };
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
    for (const key of Object.keys(px) as (keyof LaunchTradesColumnWidths)[]) {
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
    if (!gridRef) return;

    activeResizeCleanup?.();
    activeResizeCleanup = null;
    event.preventDefault();

    const leftKey = COLUMN_ORDER[boundaryIndex];
    const rightKey = COLUMN_ORDER[boundaryIndex + 1];
    if (!leftKey || !rightKey) return;

    const gridWidthPx = gridRef.getBoundingClientRect().width;
    if (gridWidthPx === 0) return;

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
    if (copyResetTimer !== null) clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      copiedTradeKey = null;
      copyResetTimer = null;
    }, 2_000);
  }

  async function retryFetch(): Promise<void> {
    const requestId = activeRequestId;
    isLoading = true;
    loadError = null;
    await fetchTrades(tokenAccountId, requestId, false);
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
      style={`--recent-trades-user-columns: ${gridTemplateColumns};`}
    >
      <div class="trade-header trade-grid">
        <div class="header-cell">
          <span>Time</span>
          <button
            type="button"
            class="filter-btn"
            class:active={afterMillisFilter !== null || beforeMillisFilter !== null}
            onclick={() => openFilterModal("time")}
            aria-label="Filter by time range"
            title="Filter time range"
          ><Funnel size={14} strokeWidth={2} /></button>
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
          <span class="type-header-label">Type</span>
          <button
            type="button"
            class="side-filter-btn"
            class:active={sideFilter !== "both"}
            onclick={cycleSideFilter}
            aria-label={`Filter trade type: ${sideFilter}`}
            title="Cycle trade type filter"
          >{sideFilter.toUpperCase()}</button>
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
            class="filter-btn"
            class:active={minUsdFilter !== null}
            onclick={() => openFilterModal("amount")}
            aria-label="Filter by minimum USD amount"
            title="Filter amount"
          ><Funnel size={14} strokeWidth={2} /></button>
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
            class="filter-btn"
            class:active={Boolean(traderFilter)}
            onclick={() => openFilterModal("trader")}
            aria-label="Filter by trader"
            title="Filter trader"
          ><Funnel size={14} strokeWidth={2} /></button>
          <button
            type="button"
            class="header-source-btn"
            onclick={toggleTraderExplorer}
            aria-label={`Change trader explorer; current: ${getExplorerLabel(settings.traderExplorer)}`}
            title={`${getExplorerLabel(settings.traderExplorer)} trader links enabled`}
          >
            <span class="source-long">
              {getExplorerLabel(settings.traderExplorer)}
            </span>
            <span class="source-short" aria-hidden="true">
              {getExplorerAbbreviation(settings.traderExplorer)}
            </span>
          </button>
          <button
            type="button"
            class="column-resizer"
            aria-label="Resize Trader and Txn columns"
            onpointerdown={(event) => startColumnResize(event, 3)}
          ></button>
        </div>

        <div class="header-cell header-cell-last">
          <span class="txn-header-label">Txn</span>
          <button
            type="button"
            class="header-source-btn"
            onclick={toggleTxnExplorer}
            aria-label={`Change transaction explorer; current: ${getExplorerLabel(settings.txnExplorer)}`}
            title={`${getExplorerLabel(settings.txnExplorer)} transaction links enabled`}
          >
            {getExplorerAbbreviation(settings.txnExplorer)}
          </button>
        </div>
      </div>

      {#if isLoading && !filteredTrades.length}
        <div class="table-state">Loading recent trades...</div>
      {:else if !filteredTrades.length}
        <div class="table-state">No trades match these filters.</div>
      {:else}
        <div class="trade-body">
          {#each filteredTrades as trade, index (trade.transaction_id)}
            {@const tradeType = getTradeType(trade)}
            {@const tradeKey = trade.transaction_id}
            <article
              class="trade-row trade-grid"
              class:buy={tradeType === "BUY"}
              class:sell={tradeType === "SELL"}
              animate:flip={{ duration: 180, easing: cubicOut }}
              use:paginationSentinel={index === filteredTrades.length - 10}
            >
              <div class="trade-cell time-cell neutral-cell">
                {formatTradeTime(Number(trade.block_timestamp_nanosec) / 1000000)}
              </div>
              <button
                type="button"
                class="trade-cell type-cell type-filter-cell"
                onclick={() => {
                  sideFilter = tradeType.toLowerCase() as "buy" | "sell";
                  resetAndFetchTrades();
                }}
                aria-label={`Show only ${tradeType} trades`}
                title={`Filter by ${tradeType}`}
              >{tradeType}</button>
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
                <button
                  type="button"
                  class="trader-filter-btn"
                  class:active={traderFilter === trade.trader}
                  onclick={() => toggleTraderFilter(trade.trader)}
                  aria-label={traderFilter === trade.trader
                    ? `Remove trader filter for ${trade.trader}`
                    : `Filter by trader ${trade.trader}`}
                  title={traderFilter === trade.trader
                    ? "Remove trader filter"
                    : "Show trades by this trader"}
                ><Funnel size={14} strokeWidth={2} /></button>
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
          {#if isLoadingMore}
            <div class="loading-more">Loading more trades...</div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</section>

{#if filterModal}
  <div
    class="filter-modal-backdrop"
    role="presentation"
    onclick={closeFilterModal}
    onkeydown={(event) => event.key === "Escape" && closeFilterModal()}
    transition:fade={{ duration: 150 }}
  >
    <div
      class="filter-modal"
      bind:this={filterModalRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="trade-filter-title"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={handleFilterModalKeydown}
      transition:fly={{ y: 20, duration: 200 }}
    >
      <div class="filter-modal-header">
        <h2 id="trade-filter-title">
          {filterModal === "time"
            ? "Filter by time"
            : filterModal === "amount"
              ? "Filter by amount"
              : "Filter by trader"}
        </h2>
        <button type="button" class="modal-close-btn" onclick={closeFilterModal} aria-label="Close filter">
          <X size={22} strokeWidth={2} />
        </button>
      </div>

      <div class="filter-modal-body">
        {#if filterModal === "time"}
          <div class="time-filter-fields">
            <label for="after-time">After</label>
            <input id="after-time" type="datetime-local" bind:value={draftAfterTime} />
            <label for="before-time">Before</label>
            <input id="before-time" type="datetime-local" bind:value={draftBeforeTime} />
          </div>
        {:else if filterModal === "amount"}
          <span class="filter-label">Minimum USD amount</span>
          <div class="amount-filter-grid" aria-label="Minimum USD amount">
            {#each USD_THRESHOLDS as threshold, index}
              <button
                type="button"
                class:active={draftMinUsd === threshold}
                class:last-amount-filter={index === USD_THRESHOLDS.length - 1}
                onclick={() => (draftMinUsd = threshold)}
              >${threshold.toLocaleString()}+</button>
            {/each}
          </div>
        {:else}
          <div class="trader-filter-field">
            <label for="trader-account">Trader account</label>
            <input id="trader-account" bind:value={draftTrader} placeholder="account.near" />
          </div>
        {/if}
      </div>

      <div class="filter-modal-actions">
        <button type="button" class="filter-clear-btn" onclick={() => {
          if (filterModal === "time") {
            draftAfterTime = "";
            draftBeforeTime = "";
          } else if (filterModal === "amount") draftMinUsd = null;
          else draftTrader = "";
        }}>Clear</button>
        <button type="button" class="filter-apply-btn" onclick={applyFilterModal}>Apply</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .recent-trades-card {
    container-type: inline-size;
    box-sizing: border-box;
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
    --recent-trades-columns: var(--recent-trades-user-columns);
    box-sizing: border-box;
    min-width: 440px;
    width: 100%;
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
    overflow: hidden;
    background: color-mix(in oklab, var(--bg-card), var(--bg-input) 25%);
  }

  .trade-grid {
    display: grid;
    grid-template-columns: var(--recent-trades-columns);
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

  .source-short {
    display: none;
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

  .filter-btn,
  .side-filter-btn {
    border: 1px solid var(--border-color);
    border-radius: 0.38rem;
    background: transparent;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 1.35rem;
    cursor: pointer;
  }

  .filter-btn {
    width: 1.35rem;
    padding: 0;
  }

  .side-filter-btn {
    padding: 0 0.3rem;
    font: inherit;
    font-size: 0.62rem;
  }

  .filter-btn:hover,
  .side-filter-btn:hover,
  .filter-btn.active,
  .side-filter-btn.active {
    border-color: var(--accent-primary);
    color: var(--accent-primary);
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

  .trade-body .trade-row:nth-child(odd) {
    background: color-mix(in oklab, var(--bg-card), var(--bg-input) 4%);
  }

  .trade-body .trade-row:nth-child(even) {
    background: color-mix(in oklab, var(--bg-card), var(--bg-input) 28%);
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
    overflow: hidden;
    font-family: "JetBrains Mono", monospace;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .type-filter-cell {
    width: 100%;
    height: 100%;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .type-filter-cell:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .neutral-cell {
    color: var(--text-secondary);
  }

  .time-cell {
    overflow: hidden;
    font-family: "JetBrains Mono", monospace;
    font-size: 0.78rem;
    color: var(--text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
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

  .trader-filter-btn,
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

  .trader-filter-btn {
    border: 0;
    padding: 0;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    display: inline-flex;
  }

  .trader-filter-btn:hover,
  .trader-filter-btn.active,
  .copy-btn:hover {
    color: var(--text-primary);
    background: var(--bg-input);
  }

  .trader-filter-btn.active {
    color: var(--accent-primary);
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

  .table-state,
  .loading-more {
    padding: 0.9rem;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.85rem;
  }


  .filter-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(4px);
  }

  .filter-modal {
    width: 100%;
    max-width: 440px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: 1.25rem;
    background: var(--bg-card);
    color: var(--text-primary);
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
  }

  .filter-modal-header {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--border-color);
  }

  .filter-modal-actions {
    display: flex;
    flex-shrink: 0;
    gap: 0.75rem;
    padding: 1.25rem 1.5rem;
    border-top: 1px solid var(--border-color);
  }

  .filter-modal h2 {
    margin: 0;
    color: var(--text-primary);
    font-size: 1.25rem;
    font-weight: 700;
  }

  .filter-modal-body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 0.75rem;
    overflow-y: auto;
    padding: 1.5rem;
  }

  .filter-modal label,
  .filter-label {
    color: var(--text-primary);
    font-size: 0.875rem;
    font-weight: 600;
  }

  .time-filter-fields,
  .trader-filter-field {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .time-filter-fields label:not(:first-child) {
    margin-top: 0.25rem;
  }

  .filter-modal input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--border-color);
    border-radius: 0.625rem;
    padding: 0.75rem 1rem;
    background: var(--bg-input);
    color: var(--text-primary);
    font: inherit;
    outline: none;
    transition: border-color 0.2s ease;
  }

  .filter-modal input:focus {
    border-color: var(--accent-primary);
  }

  .amount-filter-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.5rem;
  }

  .amount-filter-grid button {
    border: 1px solid var(--border-color);
    border-radius: 0.6rem;
    padding: 0.65rem 0.4rem;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .amount-filter-grid button:hover,
  .amount-filter-grid button.active {
    border-color: var(--accent-primary);
    background: var(--bg-input);
    color: var(--accent-primary);
  }

  .amount-filter-grid .last-amount-filter {
    grid-column: 1 / -1;
  }

  .filter-clear-btn,
  .filter-apply-btn {
    flex: 1;
    border-radius: 0.75rem;
    padding: 0.875rem 1.5rem;
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .filter-clear-btn {
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .filter-clear-btn:hover {
    background: var(--bg-input);
    border-color: var(--text-muted);
  }

  .modal-close-btn {
    width: 2.25rem;
    height: 2.25rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0;
    border: none;
    border-radius: 0.5rem;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .modal-close-btn:hover {
    background: var(--bg-input);
    color: var(--text-primary);
  }

  .filter-apply-btn {
    border: none;
    background: var(--accent-button-small);
    color: var(--text-on-accent);
  }

  .filter-apply-btn:hover {
    background: var(--accent-hover);
  }

  @container (max-width: 700px) {
    .trades-grid {
      --recent-trades-columns: 19% 16% 16% 41.5% 7.5%;
    }

    .column-resizer,
    .source-long,
    .txn-header-label {
      display: none;
    }

    .source-short {
      display: inline;
    }

    .header-cell,
    .trade-cell {
      padding-left: 0.45rem;
      padding-right: 0.45rem;
    }

    .header-cell {
      gap: 0.25rem;
      overflow: hidden;
      font-size: 0.7rem;
      white-space: nowrap;
    }

    .trade-cell {
      font-size: 0.78rem;
    }

    .trader-cell {
      gap: 0.3rem;
    }
  }

  @media (--tablet) {
    .recent-trades-card {
      padding-inline: 0.75rem;
    }

    .filter-modal-backdrop {
      align-items: flex-end;
      padding: 0;
    }

    .filter-modal {
      max-width: 100%;
      max-height: 95vh;
      border-bottom: none;
      border-radius: 1.25rem 1.25rem 0 0;
    }

    .filter-modal-header {
      padding: 1rem 1.25rem;
    }

    .filter-modal h2 {
      font-size: 1.125rem;
    }

    .filter-modal-body {
      padding: 1.25rem;
    }

    .filter-modal-actions {
      padding: 1rem 1.25rem;
      padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
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
