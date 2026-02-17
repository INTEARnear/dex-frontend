import { tokenHubStore } from "../tokenHubStore";
import type { AssetWithBalance, TokenInfo, XykPool } from "../types";
import { DEX_BACKEND_API } from "../utils";
import type {
  StatsAssetListItem,
  StatsPoolListItem,
  StatsSeriesPoint,
  StatsTab,
  StatsTimeframe,
  TvlSeriesPointResponse,
  VolumeSeriesPointResponse,
  VolumeTopAssetResponseItem,
  VolumeTopPoolResponseItem,
} from "./types";

type TimeframeSegment = "day" | "week" | "month";

interface PoolDescriptor {
  poolId: number;
  assets: [AssetWithBalance, AssetWithBalance];
  tokens: [TokenInfo | null, TokenInfo | null];
}

const TIMEFRAME_TO_SEGMENT: Record<StatsTimeframe, TimeframeSegment> = {
  Day: "day",
  Week: "week",
  Month: "month",
};

async function fetchJson<TResponse>(path: string): Promise<TResponse> {
  const response = await fetch(`${DEX_BACKEND_API}${path}`);
  if (!response.ok) {
    throw new Error(`Request failed for ${path}: HTTP ${response.status}`);
  }
  return (await response.json()) as TResponse;
}

function toTimeframeSegment(timeframe: StatsTimeframe): TimeframeSegment {
  return TIMEFRAME_TO_SEGMENT[timeframe];
}

function parseNonNegativeNumber(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseFloat(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}

async function fetchPoolDescriptors(): Promise<PoolDescriptor[]> {
  const pools = await fetchJson<XykPool[]>("/pools/all");
  const descriptors: Array<{
    poolId: number;
    assets: [AssetWithBalance, AssetWithBalance];
  }> = [];
  const uniqueAssetIds = new Set<string>();

  for (const pool of pools) {
    const assets = pool.pool.Private
      ? pool.pool.Private.assets
      : pool.pool.Public?.assets;
    if (!assets) continue;

    uniqueAssetIds.add(assets[0].asset_id);
    uniqueAssetIds.add(assets[1].asset_id);

    descriptors.push({
      poolId: pool.id,
      assets,
    });
  }

  await tokenHubStore.refreshTokens();
  await Promise.allSettled(
    Array.from(uniqueAssetIds).map((assetId) =>
      tokenHubStore.ensureTokenByAssetId(assetId),
    ),
  );

  return descriptors.map((descriptor) => ({
    ...descriptor,
    tokens: [
      tokenHubStore.selectToken(descriptor.assets[0].asset_id),
      tokenHubStore.selectToken(descriptor.assets[1].asset_id),
    ] as [TokenInfo | null, TokenInfo | null],
  }));
}

function calculateAssetUsd(asset: AssetWithBalance): number {
  const token = tokenHubStore.selectToken(asset.asset_id);
  if (!token) return 0;

  const decimals = token.metadata.decimals;
  const rawBalance = Number.parseFloat(asset.balance);
  const price = Number.parseFloat(token.price_usd || "0");
  if (!Number.isFinite(rawBalance) || !Number.isFinite(price)) return 0;

  const amount = rawBalance / Math.pow(10, decimals);
  const usdValue = amount * price;
  if (!Number.isFinite(usdValue) || usdValue <= 0) return 0;

  return usdValue;
}

function sortPoolsByValue(items: StatsPoolListItem[]): StatsPoolListItem[] {
  return items.sort((left, right) => {
    if (right.valueUsd !== left.valueUsd) return right.valueUsd - left.valueUsd;
    return left.poolId - right.poolId;
  });
}

function sortAssetsByValue(items: StatsAssetListItem[]): StatsAssetListItem[] {
  return items.sort((left, right) => {
    if (right.valueUsd !== left.valueUsd) return right.valueUsd - left.valueUsd;
    return left.assetId.localeCompare(right.assetId);
  });
}

function normalizeVolumeSeries(
  rows: VolumeSeriesPointResponse[],
): StatsSeriesPoint[] {
  return rows
    .map((row) => ({
      timestamp: row.timestamp,
      valueUsd: parseNonNegativeNumber(row.volume_usd),
    }))
    .sort(
      (left, right) =>
        new Date(left.timestamp).getTime() -
        new Date(right.timestamp).getTime(),
    );
}

function normalizeTvlSeries(
  rows: TvlSeriesPointResponse[],
): StatsSeriesPoint[] {
  return rows
    .map((row) => ({
      timestamp: row.timestamp,
      valueUsd: parseNonNegativeNumber(row.tvl_usd),
    }))
    .sort(
      (left, right) =>
        new Date(left.timestamp).getTime() -
        new Date(right.timestamp).getTime(),
    );
}

export async function fetchTotalSeries(
  tab: StatsTab,
  timeframe: StatsTimeframe,
): Promise<StatsSeriesPoint[]> {
  const timeframeSegment = toTimeframeSegment(timeframe);
  if (tab === "Volume") {
    const rows = await fetchJson<VolumeSeriesPointResponse[]>(
      `/stats/volume/total/${timeframeSegment}`,
    );
    return normalizeVolumeSeries(rows);
  }

  const rows = await fetchJson<TvlSeriesPointResponse[]>(
    `/stats/tvl/total/${timeframeSegment}`,
  );
  return normalizeTvlSeries(rows);
}

export async function fetchPoolSeries(
  tab: StatsTab,
  poolId: number,
  timeframe: StatsTimeframe,
): Promise<StatsSeriesPoint[]> {
  const timeframeSegment = toTimeframeSegment(timeframe);
  if (tab === "Volume") {
    const rows = await fetchJson<VolumeSeriesPointResponse[]>(
      `/stats/volume/pool/${poolId}/${timeframeSegment}`,
    );
    return normalizeVolumeSeries(rows);
  }

  const rows = await fetchJson<TvlSeriesPointResponse[]>(
    `/stats/tvl/pool/${poolId}/${timeframeSegment}`,
  );
  return normalizeTvlSeries(rows);
}

export async function fetchAssetSeries(
  tab: StatsTab,
  assetId: string,
  timeframe: StatsTimeframe,
): Promise<StatsSeriesPoint[]> {
  const timeframeSegment = toTimeframeSegment(timeframe);
  const encodedAssetId = encodeURIComponent(assetId);
  if (tab === "Volume") {
    const rows = await fetchJson<VolumeSeriesPointResponse[]>(
      `/stats/volume/asset/${encodedAssetId}/${timeframeSegment}`,
    );
    return normalizeVolumeSeries(rows);
  }

  const rows = await fetchJson<TvlSeriesPointResponse[]>(
    `/stats/tvl/asset/${encodedAssetId}/${timeframeSegment}`,
  );
  return normalizeTvlSeries(rows);
}

export async function fetchVolumePoolItems(
  timeframe: StatsTimeframe,
): Promise<StatsPoolListItem[]> {
  const timeframeSegment = toTimeframeSegment(timeframe);
  const [topRows, descriptors] = await Promise.all([
    fetchJson<VolumeTopPoolResponseItem[]>(
      `/stats/top/pools/${timeframeSegment}`,
    ),
    fetchPoolDescriptors(),
  ]);

  const valueByPoolId = new Map<number, number>();
  for (const row of topRows) {
    valueByPoolId.set(row.pool_id, parseNonNegativeNumber(row.volume_usd));
  }

  const items: StatsPoolListItem[] = descriptors.map((descriptor) => {
    const [tokenA, tokenB] = descriptor.tokens;
    return {
      kind: "pool",
      poolId: descriptor.poolId,
      valueUsd: valueByPoolId.get(descriptor.poolId) ?? 0,
      primaryLabel: `Pool #${descriptor.poolId}`,
      secondaryLabel: `${tokenA?.metadata.symbol ?? "?"}-${tokenB?.metadata.symbol ?? "?"}`,
      tokens: descriptor.tokens,
    };
  });

  for (const row of topRows) {
    if (items.some((item) => item.poolId === row.pool_id)) continue;
    items.push({
      kind: "pool",
      poolId: row.pool_id,
      valueUsd: parseNonNegativeNumber(row.volume_usd),
      primaryLabel: `Pool #${row.pool_id}`,
      secondaryLabel: "?-?",
      tokens: [null, null],
    });
  }

  return sortPoolsByValue(items);
}

export async function fetchVolumeAssetItems(
  timeframe: StatsTimeframe,
): Promise<StatsAssetListItem[]> {
  const timeframeSegment = toTimeframeSegment(timeframe);
  const [topRows, descriptors] = await Promise.all([
    fetchJson<VolumeTopAssetResponseItem[]>(
      `/stats/top/assets/${timeframeSegment}`,
    ),
    fetchPoolDescriptors(),
  ]);

  const valueByAssetId = new Map<string, number>();
  for (const row of topRows) {
    valueByAssetId.set(row.asset_id, parseNonNegativeNumber(row.volume_usd));
  }

  const allAssetIds = new Set<string>();
  for (const descriptor of descriptors) {
    allAssetIds.add(descriptor.assets[0].asset_id);
    allAssetIds.add(descriptor.assets[1].asset_id);
  }
  for (const row of topRows) {
    allAssetIds.add(row.asset_id);
  }

  const items: StatsAssetListItem[] = Array.from(allAssetIds).map((assetId) => {
    const token = tokenHubStore.selectToken(assetId);
    return {
      kind: "asset",
      assetId,
      valueUsd: valueByAssetId.get(assetId) ?? 0,
      primaryLabel: token?.metadata.symbol ?? "?",
      secondaryLabel: assetId,
      token,
    };
  });

  return sortAssetsByValue(items);
}

export async function fetchTvlPoolItems(): Promise<StatsPoolListItem[]> {
  const descriptors = await fetchPoolDescriptors();
  const items: StatsPoolListItem[] = descriptors.map((descriptor) => {
    const [tokenA, tokenB] = descriptor.tokens;
    const valueUsd =
      calculateAssetUsd(descriptor.assets[0]) +
      calculateAssetUsd(descriptor.assets[1]);
    return {
      kind: "pool",
      poolId: descriptor.poolId,
      valueUsd,
      primaryLabel: `Pool #${descriptor.poolId}`,
      secondaryLabel: `${tokenA?.metadata.symbol ?? "?"}-${tokenB?.metadata.symbol ?? "?"}`,
      tokens: descriptor.tokens,
    };
  });

  return sortPoolsByValue(items);
}

export async function fetchTvlAssetItems(): Promise<StatsAssetListItem[]> {
  const descriptors = await fetchPoolDescriptors();
  const valueByAssetId = new Map<string, number>();

  for (const descriptor of descriptors) {
    for (const asset of descriptor.assets) {
      const current = valueByAssetId.get(asset.asset_id) ?? 0;
      valueByAssetId.set(asset.asset_id, current + calculateAssetUsd(asset));
    }
  }

  const items: StatsAssetListItem[] = Array.from(valueByAssetId.entries()).map(
    ([assetId, valueUsd]) => {
      const token = tokenHubStore.selectToken(assetId);
      return {
        kind: "asset",
        assetId,
        valueUsd,
        primaryLabel: token?.metadata.symbol ?? "?",
        secondaryLabel: assetId,
        token,
      };
    },
  );

  return sortAssetsByValue(items);
}
