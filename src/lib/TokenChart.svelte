<script lang="ts" module>
  import type { LaunchTradeChartMarker } from "./launch/types";

  const CHARTING_LIBRARY_URL =
    "https://dynamic-moxie-09a484.netlify.app/charting_library.standalone.js";
  const CHARTING_LIBRARY_PATH =
    "https://dynamic-moxie-09a484.netlify.app/";
  const PRICES_API = "https://prices.intear.tech";
  const PRICE_EVENTS_WS =
    "wss://ws-events-v3.intear.tech/events/price_token";
  const USDT_DECIMALS = 6;
  const CHART_SCALE_STORAGE_KEY = "token-chart-scale";
  const SUPPORTED_RESOLUTIONS = [
    "1",
    "5",
    "15",
    "60",
    "240",
    "1D",
    "1W",
  ];

  interface ChartBar {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }

  interface OhlcResponseBar {
    timestamp_millis: number;
    open: number | string;
    high: number | string;
    low: number | string;
    close: number | string;
    volume: number | string;
  }

  interface ChartMark {
    id: string;
    time: number;
    color: "green" | "red";
    text: string;
    label: "B" | "S";
    labelFontColor: string;
    minSize: number;
  }

  interface PriceEvent {
    token?: unknown;
    timestamp_nanosec?: unknown;
    price_usd?: unknown;
  }

  interface TokenMetadata {
    name: string;
    symbol: string;
    decimals: number;
    icon: string | null;
  }


  interface SymbolInfo {
    ticker?: string;
    name: string;
    full_name?: string;
  }

  interface HistoryPeriod {
    countBack: number;
    to: number;
  }

  interface TradingViewChart {
    onIntervalChanged(): {
      subscribe(
        context: null,
        callback: (interval: string) => void,
      ): void;
    };
    refreshMarks(): void;
  }

  interface TradingViewWidget {
    activeChart(): TradingViewChart;
    onChartReady(callback: () => void): void;
    remove(): void;
  }

  interface TradingViewWidgetOptions {
    autosize: boolean;
    container: HTMLElement;
    datafeed: unknown;
    disabled_features: string[];
    enabled_features: string[];
    interval: string;
    library_path: string;
    locale: string;
    symbol: string;
    theme: "light" | "dark";
  }

  interface DatafeedSubscription {
    reconnectDelayMs: number;
    reconnectTimer: number | null;
    socket: WebSocket | null;
    stopped: boolean;
  }

  interface ChartDatafeed {
    onReady(callback: (configuration: object) => void): void;
    resolveSymbol(
      symbolName: string,
      onSymbolResolved: (symbol: object) => void,
      onResolveError: (reason: string) => void,
    ): Promise<void>;
    getBars(
      symbolInfo: SymbolInfo,
      resolution: string,
      period: HistoryPeriod,
      onHistory: (bars: ChartBar[], metadata: { noData: boolean }) => void,
      onError: (reason: string) => void,
    ): Promise<void>;
    subscribeBars(
      symbolInfo: SymbolInfo,
      resolution: string,
      onTick: (bar: ChartBar) => void,
      listenerGuid: string,
    ): Promise<void>;
    unsubscribeBars(listenerGuid: string): void;
    getMarks(
      symbolInfo: SymbolInfo,
      from: number,
      to: number,
      onData: (marks: ChartMark[]) => void,
      resolution: string,
    ): void;
    getServerTime(callback: (unixTime: number) => void): void;
    dispose(): void;
  }

  declare global {
    interface Window {
      TradingView?: {
        widget: new (options: TradingViewWidgetOptions) => TradingViewWidget;
      };
    }
  }

  let chartingLibraryPromise: Promise<void> | null = null;

  function loadChartingLibrary(): Promise<void> {
    if (window.TradingView?.widget) return Promise.resolve();
    if (chartingLibraryPromise) return chartingLibraryPromise;

    chartingLibraryPromise = new Promise<void>((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>(
        `script[src="${CHARTING_LIBRARY_URL}"]`,
      );
      const script = existingScript ?? document.createElement("script");

      const handleLoad = () => {
        cleanupListeners();
        if (window.TradingView?.widget) {
          resolve();
        } else {
          reject(new Error("The charting library did not expose TradingView.widget"));
        }
      };
      const handleError = () => {
        cleanupListeners();
        reject(new Error("Failed to load the charting library"));
      };
      const cleanupListeners = () => {
        script.removeEventListener("load", handleLoad);
        script.removeEventListener("error", handleError);
      };

      script.addEventListener("load", handleLoad, { once: true });
      script.addEventListener("error", handleError, { once: true });

      if (!existingScript) {
        script.src = CHARTING_LIBRARY_URL;
        script.async = true;
        document.head.appendChild(script);
      }
    }).catch((error: unknown) => {
      chartingLibraryPromise = null;
      throw error;
    });

    return chartingLibraryPromise;
  }

  function resolutionToMs(resolution: string): number {
    switch (resolution) {
      case "1":
        return 60_000;
      case "5":
        return 5 * 60_000;
      case "15":
        return 15 * 60_000;
      case "60":
        return 60 * 60_000;
      case "240":
        return 4 * 60 * 60_000;
      case "1D":
        return 24 * 60 * 60_000;
      case "1W":
        return 7 * 24 * 60 * 60_000;
      default:
        throw new Error(`Unsupported chart resolution: ${resolution}`);
    }
  }

  function alignTimeToResolution(
    timestampMs: number,
    resolution: string,
  ): number {
    if (resolution === "1D") {
      const date = new Date(timestampMs);
      return Date.UTC(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate(),
      );
    }

    if (resolution === "1W") {
      const date = new Date(timestampMs);
      const daysSinceMonday = (date.getUTCDay() + 6) % 7;
      return (
        Date.UTC(
          date.getUTCFullYear(),
          date.getUTCMonth(),
          date.getUTCDate(),
        ) -
        daysSinceMonday * 24 * 60 * 60_000
      );
    }

    const intervalMs = resolutionToMs(resolution);
    return Math.floor(timestampMs / intervalMs) * intervalMs;
  }

  function createFlatBar(time: number, price: number): ChartBar {
    return {
      time,
      open: price,
      high: price,
      low: price,
      close: price,
      volume: 0,
    };
  }

  function symbolTokenId(symbolInfo: SymbolInfo): string {
    return (
      symbolInfo.ticker ??
      symbolInfo.full_name ??
      symbolInfo.name
    ).toLowerCase();
  }

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown chart data error";
  }

  function loadChartScale(): string {
    try {
      const scale = localStorage.getItem(CHART_SCALE_STORAGE_KEY);
      return scale && SUPPORTED_RESOLUTIONS.includes(scale) ? scale : "1";
    } catch {
      return "1";
    }
  }

  function saveChartScale(scale: string): void {
    if (!SUPPORTED_RESOLUTIONS.includes(scale)) return;

    try {
      localStorage.setItem(CHART_SCALE_STORAGE_KEY, scale);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }

  function createDatafeed(options: {
    metadata: TokenMetadata;
    getPriceUsd: () => number | null;
    getTraderTrades: () => LaunchTradeChartMarker[];
  }): ChartDatafeed {
    const latestBars = new Map<string, ChartBar>();
    const subscriptions = new Map<string, DatafeedSubscription>();
    const abortControllers = new Set<AbortController>();
    let disposed = false;

    const streamKey = (tokenId: string, resolution: string) =>
      `${tokenId}/${resolution}`;

    async function fetchJson<T>(url: string): Promise<T> {
      const controller = new AbortController();
      abortControllers.add(controller);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Chart request failed: HTTP ${response.status}`);
        }
        return (await response.json()) as T;
      } finally {
        abortControllers.delete(controller);
      }
    }


    function stopSubscription(listenerGuid: string): void {
      const subscription = subscriptions.get(listenerGuid);
      if (!subscription) return;

      subscription.stopped = true;
      if (subscription.reconnectTimer !== null) {
        clearTimeout(subscription.reconnectTimer);
      }
      if (subscription.socket) {
        subscription.socket.onopen = null;
        subscription.socket.onmessage = null;
        subscription.socket.onerror = null;
        subscription.socket.onclose = null;
        subscription.socket.close();
      }
      subscriptions.delete(listenerGuid);
    }

    const datafeed: ChartDatafeed = {
      onReady(callback) {
        setTimeout(() => {
          callback({
            supports_search: false,
            supports_group_request: false,
            supports_marks: true,
            supports_timescale_marks: false,
            supports_time: true,
            supported_resolutions: SUPPORTED_RESOLUTIONS,
          });
        }, 0);
      },

      async resolveSymbol(symbolName, onSymbolResolved, _onResolveError) {
        const tokenId = symbolName.toLowerCase();
        const metadata = options.metadata;
        const price = options.getPriceUsd();
        const digits = price !== null && Number.isFinite(price) && price > 0
          ? Math.ceil(Math.max(0, -Math.log10(price))) + 3
          : 6;
        const pricescale = 10 ** Math.min(Math.max(digits, 0), 12);

        setTimeout(() => {
          if (disposed) return;
          onSymbolResolved({
            ticker: tokenId,
            name: tokenId,
            description: `${metadata.symbol}/USD`,
            type: "crypto",
            session: "24x7",
            timezone: "Etc/UTC",
            exchange: "Intear",
            minmov: 1,
            pricescale,
            has_intraday: true,
            intraday_multipliers: ["1", "5", "15", "60", "240"],
            has_daily: true,
            daily_multipliers: ["1"],
            has_empty_bars: true,
            has_weekly_and_monthly: false,
            visible_plots_set: "ohlcv",
            volume_precision: 2,
            data_status: "streaming",
            logo_urls: metadata.icon ? [metadata.icon] : [],
          });
        }, 0);
      },

      async getBars(symbolInfo, resolution, period, onHistory, onError) {
        try {
          const tokenId = symbolTokenId(symbolInfo);
          const url = new URL(`${PRICES_API}/ohlc`);
          url.searchParams.set("token", tokenId);
          url.searchParams.set("resolution", resolution);
          url.searchParams.set("count_back", String(period.countBack));
          url.searchParams.set("to", String(period.to * 1_000));

          const response = await fetchJson<OhlcResponseBar[]>(url.toString());
          if (disposed) return;
          if (!Array.isArray(response)) {
            throw new Error("The OHLC endpoint returned an invalid response");
          }

          const bars = response
            .map((bar): ChartBar | null => {
              const normalized = {
                time: Number(bar.timestamp_millis),
                open: Number(bar.open),
                high: Number(bar.high),
                low: Number(bar.low),
                close: Number(bar.close),
                volume: Number(bar.volume),
              };
              return Object.values(normalized).every(Number.isFinite)
                ? normalized
                : null;
            })
            .filter((bar): bar is ChartBar => bar !== null)
            .sort((left, right) => left.time - right.time);

          for (let index = 1; index < bars.length; index += 1) {
            bars[index].open = bars[index - 1].close;
            bars[index].high = Math.max(bars[index].high, bars[index].open);
            bars[index].low = Math.min(bars[index].low, bars[index].open);
          }

          const latestBar = bars.at(-1);
          if (latestBar) {
            const key = streamKey(tokenId, resolution);
            const currentLatest = latestBars.get(key);
            if (!currentLatest || latestBar.time > currentLatest.time) {
              latestBars.set(key, latestBar);
            }
          }

          onHistory(bars, { noData: bars.length === 0 });
        } catch (error) {
          if (!disposed && !(error instanceof DOMException && error.name === "AbortError")) {
            onError(errorMessage(error));
          }
        }
      },

      async subscribeBars(symbolInfo, resolution, onTick, listenerGuid) {
        stopSubscription(listenerGuid);

        const tokenId = symbolTokenId(symbolInfo);
        const key = streamKey(tokenId, resolution);
        const subscription: DatafeedSubscription = {
          reconnectDelayMs: 1_500,
          reconnectTimer: null,
          socket: null,
          stopped: false,
        };
        subscriptions.set(listenerGuid, subscription);

        const metadata = options.metadata;
        if (
          disposed ||
          subscription.stopped ||
          subscriptions.get(listenerGuid) !== subscription
        ) {
          return;
        }

        const connect = () => {
          if (disposed || subscription.stopped) return;

          const socket = new WebSocket(PRICE_EVENTS_WS);
          subscription.socket = socket;

          socket.onopen = () => {
            subscription.reconnectDelayMs = 1_500;
            socket.send(
              JSON.stringify({
                And: [
                  {
                    path: "token",
                    operator: { Equals: tokenId },
                  },
                ],
              }),
            );
          };

          socket.onmessage = (event) => {
            let payload: unknown;
            try {
              payload = JSON.parse(String(event.data));
            } catch {
              return;
            }
            if (!Array.isArray(payload)) return;

            for (const item of payload as PriceEvent[]) {
              if (item.token !== tokenId) continue;

              let timestampMs: number;
              try {
                timestampMs = Number(BigInt(String(item.timestamp_nanosec)) / 1_000_000n);
              } catch {
                continue;
              }

              const rawPrice = Number(item.price_usd);
              const price =
                rawPrice * 10 ** (metadata.decimals - USDT_DECIMALS);
              if (!Number.isFinite(timestampMs) || !Number.isFinite(price)) {
                continue;
              }

              const eventBarTime = alignTimeToResolution(
                timestampMs,
                resolution,
              );
              const latestBar = latestBars.get(key);
              if (!latestBar || eventBarTime < latestBar.time) continue;

              if (eventBarTime === latestBar.time) {
                const updatedBar = {
                  ...latestBar,
                  high: Math.max(latestBar.high, price),
                  low: Math.min(latestBar.low, price),
                  close: price,
                };
                latestBars.set(key, updatedBar);
                onTick(updatedBar);
                continue;
              }

              const intervalMs = resolutionToMs(resolution);
              let nextTime = latestBar.time + intervalMs;
              while (nextTime < eventBarTime) {
                const emptyBar = createFlatBar(nextTime, latestBar.close);
                latestBars.set(key, emptyBar);
                onTick(emptyBar);
                nextTime += intervalMs;
              }

              const nextBar: ChartBar = {
                time: eventBarTime,
                open: latestBar.close,
                high: Math.max(latestBar.close, price),
                low: Math.min(latestBar.close, price),
                close: price,
                volume: 0,
              };
              latestBars.set(key, nextBar);
              onTick(nextBar);
            }
          };

          socket.onerror = (error) => {
            console.error(`Chart websocket error for ${tokenId}:`, error);
          };

          socket.onclose = () => {
            if (disposed || subscription.stopped || subscription.socket !== socket) {
              return;
            }
            subscription.socket = null;
            subscription.reconnectTimer = setTimeout(() => {
              subscription.reconnectTimer = null;
              connect();
            }, subscription.reconnectDelayMs);
            subscription.reconnectDelayMs = Math.min(
              Math.floor(subscription.reconnectDelayMs * 1.8),
              30_000,
            );
          };
        };

        connect();
      },

      unsubscribeBars(listenerGuid) {
        stopSubscription(listenerGuid);
      },

      getMarks(_symbolInfo, from, to, onData, resolution) {
        const marks: ChartMark[] = [];
        const marksPerBar = new Map<number, number>();
        for (const trade of options.getTraderTrades()) {
          const time =
            alignTimeToResolution(trade.timestampMillis, resolution) / 1_000;
          if (time < from || time > to) continue;

          const count = marksPerBar.get(time) ?? 0;
          if (count >= 10) continue;
          marksPerBar.set(time, count + 1);

          const isBuy = trade.side === "buy";
          const side = isBuy ? "Buy" : "Sell";
          marks.push({
            id: trade.transactionId,
            time,
            color: isBuy ? "green" : "red",
            text:
              trade.usdValue !== null &&
              trade.usdValue !== undefined &&
              Number.isFinite(trade.usdValue)
                ? `${side} $${trade.usdValue.toFixed(2)}`
                : side,
            label: isBuy ? "B" : "S",
            labelFontColor: "white",
            minSize: 20,
          });
        }
        onData(marks);
      },

      getServerTime(callback) {
        callback(Math.floor(Date.now() / 1_000));
      },

      dispose() {
        disposed = true;
        for (const listenerGuid of [...subscriptions.keys()]) {
          stopSubscription(listenerGuid);
        }
        for (const controller of abortControllers) {
          controller.abort();
        }
        abortControllers.clear();
        latestBars.clear();
      },
    };

    return datafeed;
  }
</script>

<script lang="ts">
  import { untrack } from "svelte";

  interface Props {
    tokenAccountId: string;
    tokenName: string;
    tokenSymbol: string;
    tokenDecimals: number;
    tokenIcon: string | null;
    tokenPriceUsd: string | number;
    traderFilter?: string | null;
    traderTrades?: LaunchTradeChartMarker[];
    theme: "light" | "dark";
    title: string;
  }

  let {
    tokenAccountId,
    tokenName,
    tokenSymbol,
    tokenDecimals,
    tokenIcon,
    tokenPriceUsd,
    traderFilter = null,
    traderTrades = [],
    theme,
    title,
  }: Props = $props();

  let chartContainer = $state<HTMLDivElement | null>(null);
  let isLoading = $state(true);
  let loadError = $state<string | null>(null);
  let activeWidget: TradingViewWidget | null = null;
  let stableAccountId = $state("");
  let stableTheme = $state<"light" | "dark">("dark");

  $effect(() => {
    const nextTheme = theme;
    if (tokenAccountId !== stableAccountId) stableAccountId = tokenAccountId;
    if (nextTheme !== stableTheme) stableTheme = nextTheme;
  });

  $effect(() => {
    const selectedTrader = traderFilter?.trim() ?? "";
    const selectedTrades = traderTrades;
    const widget = activeWidget;
    if (!widget) return;

    widget.onChartReady(() => {
      if (
        widget === activeWidget &&
        selectedTrader === (traderFilter?.trim() ?? "") &&
        selectedTrades === traderTrades
      ) {
        widget.activeChart().refreshMarks();
      }
    });
  });

  $effect(() => {
    const container = chartContainer;
    const accountId = stableAccountId;
    const selectedTheme = stableTheme;
    const selectedScale = loadChartScale();
    const suppliedMetadata = untrack(() => ({
      name: tokenName,
      symbol: tokenSymbol,
      decimals: tokenDecimals,
      icon: tokenIcon,
    }));
    if (!container || !accountId) return;

    let cancelled = false;
    let widget: TradingViewWidget | null = null;
    let datafeed: ChartDatafeed | null = null;
    isLoading = true;
    loadError = null;

    void loadChartingLibrary()
      .then(() => {
        if (cancelled || !window.TradingView?.widget) return;

        datafeed = createDatafeed({
          metadata: suppliedMetadata,
          getPriceUsd: () => {
            const price = Number(untrack(() => tokenPriceUsd));
            return Number.isFinite(price) ? price : null;
          },
          getTraderTrades: () => untrack(() => traderTrades),
        });
        widget = new window.TradingView.widget({
          autosize: true,
          symbol: accountId,
          interval: selectedScale,
          container,
          datafeed,
          library_path: CHARTING_LIBRARY_PATH,
          locale: "en",
          disabled_features: [
            "use_localstorage_for_settings",
            "header_symbol_search",
          ],
          enabled_features: [
            "show_symbol_logos",
            "custom_resolutions",
            "seconds_resolution",
            "chart_style_hilo_last_price",
          ],
          theme: selectedTheme,
        });
        activeWidget = widget;
        widget.onChartReady(() => {
          if (!widget || widget !== activeWidget) return;
          widget.activeChart().onIntervalChanged().subscribe(null, saveChartScale);
        });
        isLoading = false;
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        datafeed?.dispose();
        datafeed = null;
        container.replaceChildren();
        isLoading = false;
        loadError = errorMessage(error);
      });

    return () => {
      cancelled = true;
      if (activeWidget === widget) activeWidget = null;
      widget?.remove();
      datafeed?.dispose();
      container.replaceChildren();
    };
  });
</script>

<div class="chart-shell" aria-label={title}>
  <div class="chart-container" bind:this={chartContainer}></div>
  {#if isLoading}
    <div class="chart-status">Loading chart…</div>
  {:else if loadError}
    <div class="chart-status chart-error">{loadError}</div>
  {/if}
</div>

<style>
  .chart-shell {
    position: relative;
    display: block;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    min-height: inherit;
    overflow: hidden;
    border: 1.2px solid var(--border-color);
    border-radius: 0.375rem 1rem 1rem 1rem;
    background: var(--bg-card);
  }

  .chart-container {
    width: 100%;
    height: 100%;
    min-height: inherit;
  }

  .chart-container :global(iframe) {
    display: block;
  }

  .chart-status {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: var(--bg-card);
    color: var(--text-secondary);
    font-size: 0.9rem;
    text-align: center;
  }

  .chart-error {
    color: var(--status-error-text, var(--text-secondary));
  }
</style>
