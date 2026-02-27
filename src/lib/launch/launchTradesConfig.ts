import type {
  LaunchTradesColumnWidths,
  LaunchTradesViewerConfig,
} from "./types";

const LAUNCH_TRADES_VIEWER_STORAGE_KEY = "dex-launch-trades-viewer-settings";

const DEFAULT_COLUMN_WIDTHS: LaunchTradesColumnWidths = {
  time: 18,
  type: 12,
  amount: 18,
  trader: 38,
  txn: 14,
};

type LaunchTradesViewerConfigStorage = LaunchTradesViewerConfig;

export const DEFAULT_LAUNCH_TRADES_VIEWER_CONFIG: LaunchTradesViewerConfig = {
  timeMode: "relative",
  traderExplorer: "nearblocks",
  txnExplorer: "nearblocks",
  columnWidths: DEFAULT_COLUMN_WIDTHS,
};

function createDefaultConfig(): LaunchTradesViewerConfig {
  return {
    timeMode: DEFAULT_LAUNCH_TRADES_VIEWER_CONFIG.timeMode,
    traderExplorer: DEFAULT_LAUNCH_TRADES_VIEWER_CONFIG.traderExplorer,
    txnExplorer: DEFAULT_LAUNCH_TRADES_VIEWER_CONFIG.txnExplorer,
    columnWidths: DEFAULT_COLUMN_WIDTHS,
  };
}

function normalizeColumnWidths(
  widths: LaunchTradesColumnWidths,
): LaunchTradesColumnWidths {
  const total =
    widths.time + widths.type + widths.amount + widths.trader + widths.txn;

  const normalized: LaunchTradesColumnWidths = {
    time: (widths.time / total) * 100,
    type: (widths.type / total) * 100,
    amount: (widths.amount / total) * 100,
    trader: (widths.trader / total) * 100,
    txn: (widths.txn / total) * 100,
  };

  return normalized;
}

export interface LaunchTradesViewerConfigLoadResult {
  config: LaunchTradesViewerConfig;
  loadedFromStorage: boolean;
  usedDefaultColumnWidths: boolean;
}

export function loadLaunchTradesViewerConfigWithMeta(): LaunchTradesViewerConfigLoadResult {
  const fallback = createDefaultConfig();

  const raw = localStorage.getItem(LAUNCH_TRADES_VIEWER_STORAGE_KEY);
  if (!raw) {
    return {
      config: fallback,
      loadedFromStorage: false,
      usedDefaultColumnWidths: true,
    };
  }

  const parsed = JSON.parse(raw) as LaunchTradesViewerConfigStorage;
  return {
    config: {
      timeMode: parsed.timeMode,
      traderExplorer: parsed.traderExplorer,
      txnExplorer: parsed.txnExplorer,
      columnWidths: normalizeColumnWidths(parsed.columnWidths),
    },
    loadedFromStorage: true,
    usedDefaultColumnWidths: false,
  };
}

export function loadLaunchTradesViewerConfig(): LaunchTradesViewerConfig {
  return loadLaunchTradesViewerConfigWithMeta().config;
}

export function saveLaunchTradesViewerConfig(
  config: LaunchTradesViewerConfig,
): void {
  localStorage.setItem(
    LAUNCH_TRADES_VIEWER_STORAGE_KEY,
    JSON.stringify({
      timeMode: config.timeMode,
      traderExplorer: config.traderExplorer,
      txnExplorer: config.txnExplorer,
      columnWidths: normalizeColumnWidths(config.columnWidths),
    }),
  );
}
