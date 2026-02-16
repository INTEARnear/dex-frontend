import { get, writable } from "svelte/store";
import { assetIdToTokenId } from "./pool/shared";
import type {
  TokenInfo,
  TokenResponse,
  TokenResponseWithIcon,
  UserTokenResponse,
} from "./types";
import { PRICES_API } from "./utils";
import { walletStore } from "./walletStore";

const WS_EVENTS_BASE = "wss://ws-events-v3.intear.tech/events";
const DEFAULT_PRICES_INTERVAL_MS = 10_000;
const DEFAULT_BALANCES_INTERVAL_MS: number | null = null;

type StatusState = {
  tokens: boolean;
  prices: boolean;
  balances: boolean;
  search: boolean;
};

type ErrorState = {
  tokens: string | null;
  prices: string | null;
  balances: string | null;
  search: string | null;
};

interface TokenHubState {
  tokensById: Record<string, TokenInfo>;
  order: string[];
  tokens: TokenInfo[];
  walletAccountId: string | null;
  status: StatusState;
  errors: ErrorState;
  refreshPolicy: {
    pricesIntervalMs: number | null;
    balancesIntervalMs: number | null;
  };
}

const NEAR_TOKEN_TEMPLATE: TokenInfo = {
  account_id: "near",
  price_usd: "0",
  price_usd_hardcoded: "0",
  price_usd_raw: "0",
  metadata: {
    name: "NEAR",
    symbol: "NEAR",
    decimals: 24,
    reference: null,
  },
  total_supply: "0",
  circulating_supply: "0",
  liquidity_usd: 0,
  volume_usd_24h: 0,
  reputation: "Reputable",
  created_at: 0,
};

function sanitizeIcon(icon?: string): string | undefined {
  if (!icon) return undefined;
  if (!icon.startsWith("data:")) return undefined;
  return icon;
}

function tokenIdFromLookup(tokenIdOrAssetId: string): string | null {
  if (tokenIdOrAssetId === "near") return "near";
  if (tokenIdOrAssetId.startsWith("nep141:")) {
    return assetIdToTokenId(tokenIdOrAssetId);
  }
  return tokenIdOrAssetId;
}

function computeBalanceUsd(
  token: TokenInfo,
  balanceRaw: string,
): number | undefined {
  const price = parseFloat(token.price_usd || "0");
  const decimals = token.metadata.decimals;
  const amount = Number(balanceRaw) / Math.pow(10, decimals);
  const usd = amount * (Number.isFinite(price) ? price : 0);
  if (!Number.isFinite(usd) || usd < 0) return undefined;
  return usd;
}

function scoreToken(token: TokenInfo): number {
  const volume = token.volume_usd_24h;
  const volumeScore = volume > 10 ? Math.log2(volume) : 0;
  return token.liquidity_usd * volumeScore;
}

function sortTokenIds(tokensById: Record<string, TokenInfo>): string[] {
  return Object.values(tokensById)
    .sort((a, b) => {
      const aHasBalance = (a.balanceUsd ?? 0) > 0;
      const bHasBalance = (b.balanceUsd ?? 0) > 0;
      if (aHasBalance && !bHasBalance) return -1;
      if (!aHasBalance && bHasBalance) return 1;
      if (aHasBalance && bHasBalance) {
        return (b.balanceUsd ?? 0) - (a.balanceUsd ?? 0);
      }

      const scoreDiff = scoreToken(b) - scoreToken(a);
      if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
      return (b.created_at ?? 0) - (a.created_at ?? 0);
    })
    .map((token) => token.account_id);
}

function mergeTokenInfo(
  previous: TokenInfo | undefined,
  incoming: TokenResponse | TokenResponseWithIcon,
): TokenInfo {
  const previousIcon = sanitizeIcon(previous?.metadata.icon);
  const maybeIncomingIcon = sanitizeIcon(
    (incoming.metadata as { icon?: string }).icon,
  );
  const mergedIcon = maybeIncomingIcon ?? previousIcon;

  const merged: TokenInfo = {
    ...(previous ?? {}),
    ...incoming,
    metadata: {
      ...incoming.metadata,
      ...(mergedIcon ? { icon: mergedIcon } : {}),
    },
    balance: previous?.balance,
    balanceSource: previous?.balanceSource,
    balanceUsd: previous?.balanceUsd,
  };

  return merged;
}

function syncNearFromWrap(
  tokensById: Record<string, TokenInfo>,
): Record<string, TokenInfo> {
  const wrapNear = tokensById["wrap.near"];
  const currentNear = tokensById.near ?? NEAR_TOKEN_TEMPLATE;
  if (!wrapNear) {
    if (!tokensById.near) {
      return {
        ...tokensById,
        near: {
          ...NEAR_TOKEN_TEMPLATE,
          metadata: { ...NEAR_TOKEN_TEMPLATE.metadata },
        },
      };
    }
    return tokensById;
  }

  const nearIcon =
    sanitizeIcon(currentNear.metadata.icon) ??
    sanitizeIcon((wrapNear.metadata as { icon?: string }).icon);

  return {
    ...tokensById,
    near: {
      ...currentNear,
      price_usd: wrapNear.price_usd,
      price_usd_raw: wrapNear.price_usd_raw,
      price_usd_hardcoded: wrapNear.price_usd_hardcoded,
      price_usd_raw_24h_ago: wrapNear.price_usd_raw_24h_ago,
      liquidity_usd: wrapNear.liquidity_usd,
      volume_usd_24h: wrapNear.volume_usd_24h,
      total_supply: wrapNear.total_supply,
      circulating_supply: wrapNear.circulating_supply,
      metadata: {
        ...currentNear.metadata,
        ...(nearIcon ? { icon: nearIcon } : {}),
      },
    },
  };
}

function buildTokensArray(
  tokensById: Record<string, TokenInfo>,
  order: string[],
): TokenInfo[] {
  return order
    .map((tokenId) => tokensById[tokenId])
    .filter((token): token is TokenInfo => !!token);
}

function clearBalanceFields(
  tokensById: Record<string, TokenInfo>,
): Record<string, TokenInfo> {
  const next: Record<string, TokenInfo> = {};
  for (const [tokenId, token] of Object.entries(tokensById)) {
    next[tokenId] = {
      ...token,
      balance: undefined,
      balanceSource: undefined,
      balanceUsd: undefined,
    };
  }
  return next;
}

function createTokenHubStore() {
  const { subscribe, update } = writable<TokenHubState>({
    tokensById: {
      near: {
        ...NEAR_TOKEN_TEMPLATE,
        metadata: { ...NEAR_TOKEN_TEMPLATE.metadata },
      },
    },
    order: ["near"],
    tokens: [
      { ...NEAR_TOKEN_TEMPLATE, metadata: { ...NEAR_TOKEN_TEMPLATE.metadata } },
    ],
    walletAccountId: null,
    status: {
      tokens: false,
      prices: false,
      balances: false,
      search: false,
    },
    errors: {
      tokens: null,
      prices: null,
      balances: null,
      search: null,
    },
    refreshPolicy: {
      pricesIntervalMs: DEFAULT_PRICES_INTERVAL_MS,
      balancesIntervalMs: DEFAULT_BALANCES_INTERVAL_MS,
    },
  });

  let initialized = false;
  let running = false;
  let currentWalletAccount: string | null = null;
  let walletUnsubscribe: (() => void) | null = null;
  let pricesTimer: number | null = null;
  let balancesTimer: number | null = null;
  let balanceDebounceTimer: number | null = null;
  let activeSockets: WebSocket[] = [];

  const inflightTokenById = new Map<string, Promise<TokenInfo | null>>();
  const inflightSearchByQuery = new Map<string, Promise<TokenInfo[]>>();

  const getState = () => get({ subscribe });

  function setStatus<K extends keyof StatusState>(
    key: K,
    value: StatusState[K],
  ) {
    update((state) => ({
      ...state,
      status: { ...state.status, [key]: value },
    }));
  }

  function setError<K extends keyof ErrorState>(key: K, value: ErrorState[K]) {
    update((state) => ({
      ...state,
      errors: { ...state.errors, [key]: value },
    }));
  }

  function closeAllSockets() {
    for (const socket of activeSockets) {
      socket.close();
    }
    activeSockets = [];
  }

  function scheduleBalanceRefresh() {
    if (balanceDebounceTimer) {
      clearTimeout(balanceDebounceTimer);
    }
    balanceDebounceTimer = setTimeout(() => {
      refreshBalances();
    }, 250);
  }

  function createEventSocket(
    eventName: string,
    filter: object,
    accountId: string,
  ): WebSocket {
    let reconnectDelay = 1_000;

    const connect = (): WebSocket => {
      const ws = new WebSocket(`${WS_EVENTS_BASE}/${eventName}`);
      ws.onopen = () => {
        reconnectDelay = 1_000;
        ws.send(JSON.stringify(filter));
      };
      ws.onmessage = () => {
        scheduleBalanceRefresh();
      };
      ws.onerror = (error) => {
        console.error(`WebSocket error (${eventName}):`, error);
      };
      ws.onclose = () => {
        if (!running || currentWalletAccount !== accountId) return;
        const idx = activeSockets.indexOf(ws);
        if (idx !== -1) activeSockets.splice(idx, 1);
        setTimeout(() => {
          if (!running || currentWalletAccount !== accountId) return;
          const newWs = connect();
          activeSockets.push(newWs);
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      };
      return ws;
    };

    return connect();
  }

  function setupWebSockets(accountId: string) {
    closeAllSockets();

    const transferFilter = {
      And: [
        {
          path: ".",
          operator: {
            Or: [
              { path: "old_owner_id", operator: { Equals: accountId } },
              { path: "new_owner_id", operator: { Equals: accountId } },
            ],
          },
        },
      ],
    };
    const mintFilter = {
      And: [{ path: "owner_id", operator: { Equals: accountId } }],
    };
    const burnFilter = {
      And: [{ path: "owner_id", operator: { Equals: accountId } }],
    };

    activeSockets.push(
      createEventSocket("ft_transfer", transferFilter, accountId),
    );
    activeSockets.push(createEventSocket("ft_mint", mintFilter, accountId));
    activeSockets.push(createEventSocket("ft_burn", burnFilter, accountId));
  }

  function applyPricesTimer(intervalMs: number | null) {
    if (pricesTimer) {
      clearInterval(pricesTimer);
      pricesTimer = null;
    }
    if (!running || !intervalMs || intervalMs <= 0) return;
    pricesTimer = setInterval(() => {
      refreshPrices();
    }, intervalMs);
  }

  function applyBalancesTimer(intervalMs: number | null) {
    if (balancesTimer) {
      clearInterval(balancesTimer);
      balancesTimer = null;
    }
    if (!running || !intervalMs || intervalMs <= 0) return;
    balancesTimer = setInterval(() => {
      refreshBalances();
    }, intervalMs);
  }

  async function refreshTokens(): Promise<void> {
    setStatus("tokens", true);
    setError("tokens", null);
    try {
      const response = await fetch(`${PRICES_API}/tokens`);
      if (!response.ok) {
        throw new Error(`Failed to fetch tokens: HTTP ${response.status}`);
      }
      const data: Record<string, TokenResponse> = await response.json();

      update((state) => {
        let nextTokensById = { ...state.tokensById };
        for (const [tokenId, incoming] of Object.entries(data)) {
          nextTokensById[tokenId] = mergeTokenInfo(
            nextTokensById[tokenId],
            incoming,
          );
        }
        nextTokensById = syncNearFromWrap(nextTokensById);

        const order = sortTokenIds(nextTokensById);
        return {
          ...state,
          tokensById: nextTokensById,
          order,
          tokens: buildTokensArray(nextTokensById, order),
        };
      });
    } catch (error) {
      console.error("refreshTokens failed:", error);
      setError(
        "tokens",
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setStatus("tokens", false);
    }
  }

  async function refreshPrices(): Promise<void> {
    setStatus("prices", true);
    setError("prices", null);
    try {
      const response = await fetch(`${PRICES_API}/prices`);
      if (!response.ok) {
        throw new Error(`Failed to fetch prices: HTTP ${response.status}`);
      }
      const prices: Record<string, string> = await response.json();

      update((state) => {
        let nextTokensById = { ...state.tokensById };
        let changed = false;

        for (const [tokenId, price] of Object.entries(prices)) {
          const token = nextTokensById[tokenId];
          if (!token) continue;
          const nextToken: TokenInfo = {
            ...token,
            price_usd: price,
          };
          if (token.balance) {
            nextToken.balanceUsd = computeBalanceUsd(nextToken, token.balance);
          }
          nextTokensById[tokenId] = nextToken;
          changed = true;
        }

        if (!changed) return state;
        nextTokensById = syncNearFromWrap(nextTokensById);
        const order = sortTokenIds(nextTokensById);
        return {
          ...state,
          tokensById: nextTokensById,
          order,
          tokens: buildTokensArray(nextTokensById, order),
        };
      });
    } catch (error) {
      console.error("refreshPrices failed:", error);
      setError(
        "prices",
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setStatus("prices", false);
    }
  }

  async function refreshBalances(): Promise<void> {
    const accountId =
      currentWalletAccount ?? get(walletStore).accountId ?? null;
    if (!accountId) {
      update((state) => {
        const tokensById = clearBalanceFields(state.tokensById);
        const order = sortTokenIds(tokensById);
        return {
          ...state,
          walletAccountId: null,
          tokensById,
          order,
          tokens: buildTokensArray(tokensById, order),
        };
      });
      return;
    }

    setStatus("balances", true);
    setError("balances", null);
    try {
      const response = await fetch(
        `${PRICES_API}/get-user-tokens?account_id=${accountId}&native=true`,
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch balances: HTTP ${response.status}`);
      }
      const data: UserTokenResponse[] = await response.json();

      update((state) => {
        let nextTokensById = clearBalanceFields(state.tokensById);
        for (const row of data) {
          const tokenId = row.token.account_id;
          const merged = mergeTokenInfo(nextTokensById[tokenId], row.token);
          const withBalance: TokenInfo = {
            ...merged,
            balance: row.balance,
            balanceSource: row.source,
            balanceUsd: computeBalanceUsd(merged, row.balance),
          };
          nextTokensById[tokenId] = withBalance;
        }

        nextTokensById = syncNearFromWrap(nextTokensById);
        const order = sortTokenIds(nextTokensById);
        return {
          ...state,
          walletAccountId: accountId,
          tokensById: nextTokensById,
          order,
          tokens: buildTokensArray(nextTokensById, order),
        };
      });
    } catch (error) {
      console.error("refreshBalances failed:", error);
      setError(
        "balances",
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setStatus("balances", false);
    }
  }

  async function fetchAccountTokens(
    accountId: string,
  ): Promise<UserTokenResponse[]> {
    const response = await fetch(
      `${PRICES_API}/get-user-tokens?account_id=${accountId}&native=true`,
    );
    if (!response.ok) {
      throw new Error(
        `Failed to fetch account tokens: HTTP ${response.status}`,
      );
    }
    const data: UserTokenResponse[] = await response.json();

    update((state) => {
      let nextTokensById = { ...state.tokensById };
      for (const row of data) {
        const tokenId = row.token.account_id;
        nextTokensById[tokenId] = mergeTokenInfo(
          nextTokensById[tokenId],
          row.token,
        );
      }
      nextTokensById = syncNearFromWrap(nextTokensById);
      const order = sortTokenIds(nextTokensById);
      return {
        ...state,
        tokensById: nextTokensById,
        order,
        tokens: buildTokensArray(nextTokensById, order),
      };
    });

    return data;
  }

  async function refreshAll(): Promise<void> {
    await refreshTokens();
    await Promise.all([refreshPrices(), refreshBalances()]);
  }

  async function ensureTokenById(tokenId: string): Promise<TokenInfo | null> {
    if (tokenId === "near") {
      const near = selectToken("near");
      if (near && near.price_usd !== "0") return near;
      await ensureTokenById("wrap.near");
      return selectToken("near");
    }

    const existing = selectToken(tokenId);
    if (existing && sanitizeIcon(existing.metadata.icon)) return existing;

    const pending = inflightTokenById.get(tokenId);
    if (pending) return pending;

    const request = (async () => {
      try {
        const response = await fetch(
          `${PRICES_API}/token?token_id=${encodeURIComponent(tokenId)}`,
        );
        if (!response.ok) return null;
        const incoming: TokenResponseWithIcon = await response.json();

        update((state) => {
          let nextTokensById = { ...state.tokensById };
          nextTokensById[tokenId] = mergeTokenInfo(
            nextTokensById[tokenId],
            incoming,
          );
          nextTokensById = syncNearFromWrap(nextTokensById);
          const order = sortTokenIds(nextTokensById);
          return {
            ...state,
            tokensById: nextTokensById,
            order,
            tokens: buildTokensArray(nextTokensById, order),
          };
        });

        return selectToken(tokenId);
      } catch (error) {
        console.error(`ensureTokenById(${tokenId}) failed:`, error);
        return null;
      } finally {
        inflightTokenById.delete(tokenId);
      }
    })();

    inflightTokenById.set(tokenId, request);
    return request;
  }

  async function ensureTokenByAssetId(
    assetId: string,
  ): Promise<TokenInfo | null> {
    const tokenId = assetIdToTokenId(assetId);
    if (!tokenId) return null;
    return ensureTokenById(tokenId);
  }

  async function searchTokens(query: string): Promise<TokenInfo[]> {
    const normalized = query.trim();
    if (!normalized) return [];

    const pending = inflightSearchByQuery.get(normalized);
    if (pending) return pending;

    const request = (async () => {
      setStatus("search", true);
      setError("search", null);
      try {
        const accountId = currentWalletAccount;
        const accParam = accountId ? `&acc=${accountId}` : "";
        const response = await fetch(
          `${PRICES_API}/token-search?q=${encodeURIComponent(normalized)}&n=100${accParam}`,
        );
        if (!response.ok) return [];
        const data: TokenResponseWithIcon[] = await response.json();

        update((state) => {
          let nextTokensById = { ...state.tokensById };
          for (const incoming of data) {
            nextTokensById[incoming.account_id] = mergeTokenInfo(
              nextTokensById[incoming.account_id],
              incoming,
            );
          }
          nextTokensById = syncNearFromWrap(nextTokensById);
          const order = sortTokenIds(nextTokensById);
          return {
            ...state,
            tokensById: nextTokensById,
            order,
            tokens: buildTokensArray(nextTokensById, order),
          };
        });

        const state = getState();
        return data
          .map((token) => state.tokensById[token.account_id])
          .filter((token): token is TokenInfo => !!token);
      } catch (error) {
        console.error(`searchTokens(${normalized}) failed:`, error);
        setError(
          "search",
          error instanceof Error ? error.message : "Unknown error",
        );
        return [];
      } finally {
        setStatus("search", false);
        inflightSearchByQuery.delete(normalized);
      }
    })();

    inflightSearchByQuery.set(normalized, request);
    return request;
  }

  function selectToken(tokenIdOrAssetId: string): TokenInfo | null {
    const tokenId = tokenIdFromLookup(tokenIdOrAssetId);
    if (!tokenId) return null;
    return getState().tokensById[tokenId] ?? null;
  }

  function selectBalance(tokenIdOrAssetId: string): string | null {
    return selectToken(tokenIdOrAssetId)?.balance ?? null;
  }

  function selectPrice(tokenIdOrAssetId: string): string | null {
    return selectToken(tokenIdOrAssetId)?.price_usd ?? null;
  }

  function selectTokenList(options?: {
    sort?: "default" | "balanceUsd" | "liquidity";
    onlyWithBalance?: boolean;
  }): TokenInfo[] {
    const state = getState();
    const sort = options?.sort ?? "default";
    const onlyWithBalance = options?.onlyWithBalance ?? false;

    let list = [...state.tokens];
    if (onlyWithBalance) {
      list = list.filter((token) => (token.balanceUsd ?? 0) > 0);
    }

    if (sort === "balanceUsd") {
      list.sort((a, b) => (b.balanceUsd ?? 0) - (a.balanceUsd ?? 0));
    } else if (sort === "liquidity") {
      list.sort((a, b) => b.liquidity_usd - a.liquidity_usd);
    }

    return list;
  }

  function updatePricesEvery(intervalMs: number | null) {
    update((state) => ({
      ...state,
      refreshPolicy: {
        ...state.refreshPolicy,
        pricesIntervalMs: intervalMs,
      },
    }));
    applyPricesTimer(intervalMs);
  }

  function updateBalancesEvery(intervalMs: number | null) {
    update((state) => ({
      ...state,
      refreshPolicy: {
        ...state.refreshPolicy,
        balancesIntervalMs: intervalMs,
      },
    }));
    applyBalancesTimer(intervalMs);
  }

  function init() {
    if (initialized) return;
    initialized = true;

    walletUnsubscribe = walletStore.subscribe((walletState) => {
      const nextAccount = walletState.accountId ?? null;
      if (nextAccount === currentWalletAccount) return;

      currentWalletAccount = nextAccount;
      update((state) => ({
        ...state,
        walletAccountId: nextAccount,
      }));

      closeAllSockets();
      if (nextAccount && running) {
        setupWebSockets(nextAccount);
      }
      refreshBalances();
    });
  }

  function start() {
    init();
    if (running) return;
    running = true;

    const state = getState();
    applyPricesTimer(state.refreshPolicy.pricesIntervalMs);
    applyBalancesTimer(state.refreshPolicy.balancesIntervalMs);

    if (currentWalletAccount) {
      setupWebSockets(currentWalletAccount);
    }

    refreshAll();
  }

  function stop() {
    running = false;
    if (pricesTimer) {
      clearInterval(pricesTimer);
      pricesTimer = null;
    }
    if (balancesTimer) {
      clearInterval(balancesTimer);
      balancesTimer = null;
    }
    if (balanceDebounceTimer) {
      clearTimeout(balanceDebounceTimer);
      balanceDebounceTimer = null;
    }
    closeAllSockets();
  }

  function destroy() {
    stop();
    walletUnsubscribe?.();
    walletUnsubscribe = null;
    initialized = false;
  }

  return {
    subscribe,
    init,
    start,
    stop,
    destroy,
    updatePricesEvery,
    updateBalancesEvery,
    refreshAll,
    refreshTokens,
    refreshPrices,
    refreshBalances,
    fetchAccountTokens,
    ensureTokenById,
    ensureTokenByAssetId,
    searchTokens,
    selectToken,
    selectBalance,
    selectPrice,
    selectTokenList,
  };
}

export const tokenHubStore = createTokenHubStore();
