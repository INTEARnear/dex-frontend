<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import { page } from "$app/state";
  import { goto } from "$app/navigation";
  import { walletStore } from "./walletStore";
  import TokenSelector from "./TokenSelector.svelte";
  import TokenIcon from "./TokenIcon.svelte";
  import Spinner from "./Spinner.svelte";
  import DexPresetButtons, {
    type DexPresetButtonItem,
  } from "./DexPresetButtons.svelte";
  import TradeSettingsRow from "./TradeSettingsRow.svelte";
  import SwapSettings from "./SwapSettings.svelte";
  import type { SlippageMode, AmountPreset } from "./SwapSettings.svelte";
  import type { Token } from "./types";
  import { tokenHubStore } from "./tokenHubStore";
  import {
    formatAmount,
    humanReadableToRawAmount,
    rawAmountToHumanReadable,
    formatBalance,
    formatUsdTokenValue,
    ROUTER_API,
  } from "./utils";
  import {
    extractTransfersFromOutcome,
    type ParsedTransferEvent,
  } from "./transferEvents";
  import {
    assetIdToTokenId,
    AUTO_MAX_SLIPPAGE_PERCENT,
    AUTO_MIN_SLIPPAGE_PERCENT,
  } from "./pool/shared";
  import { createChatwootModalVisibilityController } from "./chatwootBubbleVisibility";
  import {
    loadAmountPresetsConfig,
    loadSwapSettingsConfig,
    saveAmountPresetsConfig,
    saveSwapSettingsConfig,
  } from "./swapConfig";
  import ErrorModal from "./ErrorModal.svelte";
  import ModalShell from "./ModalShell.svelte";

  const phrases = [
    "Swap tokens instantly",
    "Swap in tears",
    "Best rates across all DEXes",
    "Swap with fastest DEX aggregator",
    "Have you tried Intear Wallet?",
    "Trade even faster in Bettear Bot",
    "Trade at the speed of Internet",
  ];

  const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];

  // Route types from DEX Aggregator API
  interface FunctionCallAction {
    FunctionCall: {
      method_name: string;
      args: string;
      gas: number;
      deposit: string;
    };
  }

  interface NearTransaction {
    NearTransaction: {
      receiver_id: string;
      actions: FunctionCallAction[];
      continue_if_failed: boolean;
    };
  }

  interface IntentsQuote {
    IntentsQuote: {
      message_to_sign: string;
      quote_hash: string;
    };
  }

  type ExecutionInstruction = NearTransaction | IntentsQuote;

  interface RouteAmount {
    amount_in?: string;
    amount_out?: string;
  }

  interface Route {
    deadline: string | null;
    has_slippage: boolean;
    estimated_amount: RouteAmount;
    worst_case_amount: RouteAmount;
    dex_id: string;
    execution_instructions: ExecutionInstruction[];
    needs_unwrap: boolean;
    token_output: string;
  }

  let inputAmountHumanReadable = $state("");
  let outputAmountHumanReadable = $state("");
  let isSwapping = $state(false);
  let inputTokenId = $state<string | null>(null);
  let outputTokenId = $state<string | null>(null);
  const inputToken = $derived.by(() =>
    inputTokenId ? ($tokenHubStore.tokensById[inputTokenId] ?? null) : null,
  );
  const outputToken = $derived.by(() =>
    outputTokenId ? ($tokenHubStore.tokensById[outputTokenId] ?? null) : null,
  );
  let inputTokenSelectorOpen = $state(false);
  let outputTokenSelectorOpen = $state(false);

  const initialSwapSettings = loadSwapSettingsConfig();
  let swapSlippageMode = $state<SlippageMode>(initialSwapSettings.mode);
  let swapSlippageValue = $state(initialSwapSettings.value);
  let swapSettingsOpen = $state(false);

  const swapSettingsDisplay = $derived(
    swapSlippageMode === "auto" ? "Auto" : `${swapSlippageValue}%`,
  );

  function handleSlippageChange(mode: SlippageMode, value: number) {
    swapSlippageMode = mode;
    swapSlippageValue = value;
    saveSwapSettingsConfig(mode, value);
  }
  const initialPresets = loadAmountPresetsConfig();
  let presetsVisible = $state(initialPresets.visible);
  let amountPresets = $state<AmountPreset[]>(initialPresets.presets);

  function handlePresetsChange(visible: boolean, presets: AmountPreset[]) {
    presetsVisible = visible;
    amountPresets = presets;
    saveAmountPresetsConfig(visible, presets);
  }

  let currentRoute = $state<Route | null>(null);
  let availableRoutes = $state<Route[]>([]);
  let fixedRouteDexId = $state<string | null>(null);
  let isRoutePickerOpen = $state(false);
  let isFetchingRoute = $state(false);
  let routeAbortController: AbortController | null = null;
  let quoteRefreshInterval: ReturnType<typeof setInterval> | null = null;

  const bestRoute = $derived.by(() => availableRoutes[0] ?? null);

  const isRouteFixed = $derived(fixedRouteDexId !== null);

  const isCurrentRouteBest = $derived.by(() => {
    if (!currentRoute || !bestRoute) return false;
    return currentRoute.dex_id === bestRoute.dex_id;
  });

  const displayedRouteDexId = $derived(
    currentRoute?.dex_id ?? fixedRouteDexId ?? "None",
  );

  const isTwoStepRoute = $derived.by(() => {
    if (!currentRoute || !outputToken) return false;
    console.log(currentRoute.token_output, outputToken.account_id);
    return (
      assetIdToTokenId(currentRoute.token_output) !== outputToken.account_id
    );
  });

  type SwapMode = "exactIn" | "exactOut";
  let swapMode = $state<SwapMode>("exactIn");

  type SwapResultModalInfoTransfer = ParsedTransferEvent;

  let showErrorModal = $state(false);
  let errorMessage = $state("");
  let showSuccessModal = $state(false);
  let successTransfers = $state<SwapResultModalInfoTransfer[]>([]);
  let successStepOneInputTransfer = $state<SwapResultModalInfoTransfer | null>(
    null,
  );
  let successStepTwoIncomingTransfer = $state<SwapResultModalInfoTransfer | null>(
    null,
  );
  let successStepTwoTargetTokenId = $state<string | null>(null);
  let successStepTwoRoute = $state<Route | null>(null);
  let isFetchingSuccessStepTwoRoute = $state(false);
  let isExecutingSuccessStepTwoRoute = $state(false);
  const chatwootModalVisibility = createChatwootModalVisibilityController();

  onDestroy(() => {
    chatwootModalVisibility.dispose();
  });

  $effect(() => {
    chatwootModalVisibility.setVisible(
      showErrorModal || showSuccessModal || isRoutePickerOpen,
    );
  });

  let inputTokenBalance = $state<string | null>(null);
  let outputTokenBalance = $state<string | null>(null);

  function parsePersistedTokenId(raw: string | null): string | null {
    if (!raw) return null;
    if (!raw.startsWith("{")) return raw;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.account_id === "string") {
        return parsed.account_id;
      }
      return null;
    } catch {
      return null;
    }
  }

  // Eagerly load token hub so TokenBadge has reputable tokens for comparison.
  // Re-fetch when wallet connects/disconnects so balances & sorting stay correct.
  let lastFetchedForAccount: string | null = null;
  $effect(() => {
    const accountId = $walletStore.accountId ?? null;
    if (accountId !== lastFetchedForAccount && !$tokenHubStore.status.tokens) {
      lastFetchedForAccount = accountId;
      tokenHubStore.refreshTokens();
      tokenHubStore.refreshBalances();
    }
  });

  // Load saved tokens from URL params (from/to) or localStorage on mount
  let initialTokensLoaded = false;
  $effect(() => {
    if (initialTokensLoaded) return;
    const fromParam = page.url.searchParams.get("from");
    const toParam = page.url.searchParams.get("to");
    if (fromParam && toParam) {
      initialTokensLoaded = true;
      const pathname = page.url.pathname;
      (async () => {
        await loadDefaultToken(fromParam, true);
        await loadDefaultToken(toParam, false);
        goto(pathname, { replaceState: true });
      })();
      return;
    }
    initialTokensLoaded = true;
    try {
      const savedInput = parsePersistedTokenId(
        localStorage.getItem("intear-dex-input-token"),
      );
      const savedOutput = parsePersistedTokenId(
        localStorage.getItem("intear-dex-output-token"),
      );

      if (savedInput) {
        loadDefaultToken(savedInput, true);
      } else {
        loadDefaultToken(
          "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
          true,
        );
      }

      if (savedOutput) {
        loadDefaultToken(savedOutput, false);
      } else {
        loadDefaultToken("jambo-1679.meme-cooking.near", false);
      }
    } catch (error) {
      console.error("Failed to load saved tokens:", error);
    }
  });

  async function loadDefaultToken(tokenId: string, isInput: boolean) {
    try {
      const token = await tokenHubStore.ensureTokenById(tokenId);
      if (!token) return;
      if (isInput) {
        inputTokenId = token.account_id;
      } else {
        outputTokenId = token.account_id;
      }
    } catch (error) {
      console.error(`Failed to load default token ${tokenId}:`, error);
    }
  }

  // Save input token to localStorage when it changes
  $effect(() => {
    if (inputTokenId) {
      try {
        localStorage.setItem("intear-dex-input-token", inputTokenId);
      } catch (error) {
        console.error("Failed to save input token:", error);
      }
    }
  });

  // Save output token to localStorage when it changes
  $effect(() => {
    if (outputTokenId) {
      try {
        localStorage.setItem("intear-dex-output-token", outputTokenId);
      } catch (error) {
        console.error("Failed to save output token:", error);
      }
    }
  });

  // Update input/output balances when tokens or canonical TokenInfo balances change
  $effect(() => {
    if (!$walletStore.accountId) {
      inputTokenBalance = null;
      outputTokenBalance = null;
      return;
    }

    const tokensById = $tokenHubStore.tokensById;
    inputTokenBalance = inputTokenId
      ? (tokensById[inputTokenId]?.balance ?? "0")
      : null;
    outputTokenBalance = outputTokenId
      ? (tokensById[outputTokenId]?.balance ?? "0")
      : null;
  });

  const hasInsufficientBalance = $derived.by(() => {
    if (!inputToken || !inputTokenBalance || !$walletStore.isConnected)
      return false;

    const balance = BigInt(inputTokenBalance);

    if (swapMode === "exactIn") {
      // Check if input amount exceeds balance
      if (
        !inputAmountHumanReadable ||
        parseFloat(inputAmountHumanReadable) <= 0
      )
        return false;
      const requiredAmount = BigInt(
        humanReadableToRawAmount(
          inputAmountHumanReadable,
          inputToken.metadata.decimals,
        ),
      );
      return requiredAmount > balance;
    } else {
      // Check if max paid (worst case) exceeds balance
      if (!currentRoute?.worst_case_amount.amount_in) return false;
      const maxPaid = BigInt(currentRoute.worst_case_amount.amount_in);
      return maxPaid > balance;
    }
  });

  function getTokenIdForRouter(tokenId: string): string {
    return tokenId === "near" ? "near" : tokenId;
  }

  async function fetchRoute() {
    routeAbortController?.abort();
    const controller = new AbortController();
    routeAbortController = controller;

    if (!inputToken || !outputToken) {
      availableRoutes = [];
      currentRoute = null;
      return;
    }

    // Check we have a valid amount for the current mode
    if (swapMode === "exactIn") {
      if (
        !inputAmountHumanReadable ||
        parseFloat(inputAmountHumanReadable) <= 0
      ) {
        availableRoutes = [];
        currentRoute = null;
        clearEstimatedAmountForCurrentMode();
        return;
      }
    } else {
      if (
        !outputAmountHumanReadable ||
        parseFloat(outputAmountHumanReadable) <= 0
      ) {
        availableRoutes = [];
        currentRoute = null;
        clearEstimatedAmountForCurrentMode();
        return;
      }
    }

    isFetchingRoute = true;

    try {
      const tokenIn = getTokenIdForRouter(inputToken.account_id);
      const tokenOut = getTokenIdForRouter(outputToken.account_id);

      const params = new URLSearchParams({
        token_in: tokenIn,
        token_out: tokenOut,
        max_wait_ms: "1500",
        dexes: "Rhea,RheaDcl,Aidols,Wrap,MetaPool,Linear,XRhea,RNear,Plach",
      });

      if (swapSlippageMode === "auto") {
        params.set("slippage_type", "Auto");
        params.set(
          "min_slippage",
          (AUTO_MIN_SLIPPAGE_PERCENT / 100).toFixed(3),
        );
        params.set(
          "max_slippage",
          (AUTO_MAX_SLIPPAGE_PERCENT / 100).toFixed(3),
        );
      } else {
        params.set("slippage_type", "Fixed");
        params.set("slippage", String(swapSlippageValue / 100));
      }

      if (swapMode === "exactIn") {
        const amountIn = humanReadableToRawAmount(
          inputAmountHumanReadable,
          inputToken.metadata.decimals,
        );
        params.set("amount_in", amountIn);
      } else {
        const amountOut = humanReadableToRawAmount(
          outputAmountHumanReadable,
          outputToken.metadata.decimals,
        );
        params.set("amount_out", amountOut);
      }

      if ($walletStore.accountId) {
        params.set("trader_account_id", $walletStore.accountId);
        // No public key is available (and it's not needed for DEXes other than Near Intents which is disabled)
      }

      const response = await fetch(`${ROUTER_API}/route?${params}`, {
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `HTTP ${response.status}`);
      }

      const routes: Route[] = await response.json();
      if (controller.signal.aborted) return;
      console.log("Routes:", routes);

      // Filter routes to only include those with NearTransaction steps (Near Intents is not supported)
      const validRoutes = routes.filter((route) =>
        route.execution_instructions.every(
          (instr) => "NearTransaction" in instr,
        ),
      );

      if (validRoutes.length === 0) {
        availableRoutes = [];
        currentRoute = null;
        clearEstimatedAmountForCurrentMode();
        return;
      }

      availableRoutes = validRoutes;

      const selectedRoute = fixedRouteDexId
        ? (validRoutes.find((route) => route.dex_id === fixedRouteDexId) ??
          null)
        : validRoutes[0];

      if (!selectedRoute) {
        currentRoute = null;
        clearEstimatedAmountForCurrentMode();
        return;
      }

      currentRoute = selectedRoute;
      applyEstimatedAmountFromRoute(selectedRoute);
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("Failed to fetch quote:", error);
      availableRoutes = [];
      currentRoute = null;
      clearEstimatedAmountForCurrentMode();
    } finally {
      if (!controller.signal.aborted) {
        isFetchingRoute = false;
      }
    }
  }

  // Fetch route on input/output change
  $effect(() => {
    const inToken = inputTokenId;
    const outToken = outputTokenId;
    const mode = swapMode;
    const _sMode = swapSlippageMode;
    const _sValue = swapSlippageValue;

    const userTypedAmount =
      mode === "exactIn" ? inputAmountHumanReadable : outputAmountHumanReadable;
    const hasValidAmount = userTypedAmount && parseFloat(userTypedAmount) > 0;

    if (!hasValidAmount || !inToken || !outToken) {
      availableRoutes = [];
      currentRoute = null;
      clearEstimatedAmountForCurrentMode();
      return;
    }

    untrack(() => {
      void fetchRoute();
    });
  });

  // Refresh route every 5 seconds
  $effect(() => {
    quoteRefreshInterval = setInterval(() => {
      const hasValidAmount =
        swapMode === "exactIn"
          ? inputAmountHumanReadable && parseFloat(inputAmountHumanReadable) > 0
          : outputAmountHumanReadable &&
            parseFloat(outputAmountHumanReadable) > 0;
      if (hasValidAmount && inputToken && outputToken) {
        void fetchRoute();
      }
    }, 5000);

    return () => {
      if (quoteRefreshInterval) {
        clearInterval(quoteRefreshInterval);
      }
    };
  });

  // Get min received (exactIn) or max paid (exactOut) display
  function getWorstCaseDisplay(): {
    label: string;
    value: string;
    symbol: string;
  } | null {
    if (!currentRoute || !inputToken || !outputToken) return null;

    if (swapMode === "exactIn") {
      if (currentRoute.worst_case_amount.amount_out) {
        const raw = rawAmountToHumanReadable(
          currentRoute.worst_case_amount.amount_out,
          outputToken.metadata.decimals,
        );
        return {
          label: "Min. received",
          value: formatAmount(parseFloat(raw)),
          symbol: outputToken.metadata.symbol,
        };
      }
    } else {
      if (currentRoute.worst_case_amount.amount_in) {
        const raw = rawAmountToHumanReadable(
          currentRoute.worst_case_amount.amount_in,
          inputToken.metadata.decimals,
        );
        return {
          label: "Max. paid",
          value: formatAmount(parseFloat(raw)),
          symbol: inputToken.metadata.symbol,
        };
      }
    }
    return null;
  }

  function clearEstimatedAmountForCurrentMode() {
    if (swapMode === "exactIn") {
      outputAmountHumanReadable = "";
    } else {
      inputAmountHumanReadable = "";
    }
  }

  function applyEstimatedAmountFromRoute(route: Route) {
    if (!inputToken || !outputToken) return;

    if (swapMode === "exactIn") {
      if (route.estimated_amount.amount_out) {
        outputAmountHumanReadable = rawAmountToHumanReadable(
          route.estimated_amount.amount_out,
          outputToken.metadata.decimals,
        );
      }
      return;
    }

    if (route.estimated_amount.amount_in) {
      inputAmountHumanReadable = rawAmountToHumanReadable(
        route.estimated_amount.amount_in,
        inputToken.metadata.decimals,
      );
    }
  }

  function parseRouteAmount(raw: string | undefined): bigint | null {
    if (!raw) return null;
    try {
      return BigInt(raw);
    } catch {
      return null;
    }
  }

  function getRouteComparisonAmount(route: Route): bigint | null {
    if (swapMode === "exactIn") {
      return parseRouteAmount(route.estimated_amount.amount_out);
    }
    return parseRouteAmount(route.estimated_amount.amount_in);
  }

  function calculateRoutePenaltyPercent(
    route: Route,
    best: Route,
  ): number | null {
    const currentAmount = getRouteComparisonAmount(route);
    const bestAmount = getRouteComparisonAmount(best);

    if (currentAmount === null || bestAmount === null || bestAmount <= 0n) {
      return null;
    }

    if (swapMode === "exactIn") {
      if (currentAmount >= bestAmount) return 0;
      const penaltyBps = ((bestAmount - currentAmount) * 10000n) / bestAmount;
      if (penaltyBps === 0n && currentAmount !== bestAmount) return 0.01;
      return Number(penaltyBps) / 100;
    }

    if (currentAmount <= bestAmount) return 0;
    const penaltyBps = ((currentAmount - bestAmount) * 10000n) / bestAmount;
    if (penaltyBps === 0n && currentAmount !== bestAmount) return 0.01;
    return Number(penaltyBps) / 100;
  }

  const selectedRoutePenaltyPercent = $derived.by(() => {
    if (!isRouteFixed || !currentRoute || !bestRoute || isCurrentRouteBest) {
      return null;
    }
    return calculateRoutePenaltyPercent(currentRoute, bestRoute);
  });

  function formatPenaltyPercent(percent: number): string {
    if (!Number.isFinite(percent) || percent <= 0) return "0.00";
    const fixed = percent >= 10 ? percent.toFixed(1) : percent.toFixed(2);
    return fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  }

  function clearFixedRouteSelection() {
    fixedRouteDexId = null;
    isRoutePickerOpen = false;
    if (bestRoute) {
      currentRoute = bestRoute;
      applyEstimatedAmountFromRoute(bestRoute);
    } else {
      currentRoute = null;
    }
  }

  function handleSelectFixedRoute(route: Route) {
    fixedRouteDexId = route.dex_id;
    currentRoute = route;
    applyEstimatedAmountFromRoute(route);
    isRoutePickerOpen = false;
  }

  function openRoutePicker() {
    if (availableRoutes.length === 0) return;
    isRoutePickerOpen = true;
  }

  function formatRoutePreviewAmount(route: Route): string {
    if (!inputToken || !outputToken) return "\u2014";

    const rawAmount =
      swapMode === "exactIn"
        ? route.estimated_amount.amount_out
        : route.estimated_amount.amount_in;
    if (!rawAmount) return "\u2014";

    const decimals =
      swapMode === "exactIn"
        ? outputToken.metadata.decimals
        : inputToken.metadata.decimals;
    const symbol =
      swapMode === "exactIn"
        ? outputToken.metadata.symbol
        : inputToken.metadata.symbol;

    const humanReadable = rawAmountToHumanReadable(rawAmount, decimals);
    const numeric = parseFloat(humanReadable);
    if (!Number.isFinite(numeric)) return "\u2014";

    return `${formatAmount(numeric)} ${symbol}`;
  }

  // Get output amount for display (only formatted when it's estimated)
  function getFormattedOutputAmount(): string {
    if (!outputAmountHumanReadable) return "";
    if (swapMode === "exactOut") return outputAmountHumanReadable; // User-entered, show as-is
    const num = parseFloat(outputAmountHumanReadable);
    if (isNaN(num) || num === 0) return "0";
    return formatAmount(num);
  }

  // Get input amount for display (only formatted when it's estimated)
  function getFormattedInputAmount(): string {
    if (!inputAmountHumanReadable) return "";
    if (swapMode === "exactIn") return inputAmountHumanReadable; // User-entered, show as-is
    const num = parseFloat(inputAmountHumanReadable);
    if (isNaN(num) || num === 0) return "0";
    return formatAmount(num);
  }

  const formattedInputBalance = $derived(
    inputToken && inputTokenBalance
      ? formatBalance(inputTokenBalance, inputToken.metadata.decimals)
      : null,
  );

  const formattedOutputBalance = $derived(
    outputToken && outputTokenBalance
      ? formatBalance(outputTokenBalance, outputToken.metadata.decimals)
      : null,
  );

  const inputUsdValue = $derived(
    inputToken && inputAmountHumanReadable
      ? formatUsdTokenValue(inputAmountHumanReadable, inputToken.price_usd)
      : null,
  );

  const outputUsdValue = $derived(
    outputToken && outputAmountHumanReadable
      ? formatUsdTokenValue(outputAmountHumanReadable, outputToken.price_usd)
      : null,
  );

  // Price impact: only updated when not fetching so the previous value persists
  // during route refreshes (avoids layout shift).
  let priceImpact = $state<number | null>(null);

  $effect(() => {
    // Skip updates while a route is in-flight so the old value stays visible.
    if (isFetchingRoute) return;

    if (
      !inputToken ||
      !outputToken ||
      !inputAmountHumanReadable ||
      !outputAmountHumanReadable ||
      !currentRoute
    ) {
      priceImpact = null;
      return;
    }
    const inNum = parseFloat(inputAmountHumanReadable);
    const outNum = parseFloat(outputAmountHumanReadable);
    const inPrice = parseFloat(inputToken.price_usd);
    const outPrice = parseFloat(outputToken.price_usd);
    if (
      isNaN(inNum) ||
      isNaN(outNum) ||
      isNaN(inPrice) ||
      isNaN(outPrice) ||
      inNum <= 0 ||
      outNum <= 0 ||
      inPrice <= 0 ||
      outPrice <= 0
    ) {
      priceImpact = null;
      return;
    }
    const inUsd = inNum * inPrice;
    const outUsd = outNum * outPrice;
    priceImpact = ((inUsd - outUsd) / inUsd) * 100;
  });

  const showPriceImpactWarning = $derived(
    priceImpact !== null && priceImpact > 2.5,
  );

  const priceImpactSevere = $derived(priceImpact !== null && priceImpact > 5);

  // Calculate net amounts per token (e.g. exact-out refunds leftover attached input)
  function consolidateTransfers(
    transfers: SwapResultModalInfoTransfer[],
  ): SwapResultModalInfoTransfer[] {
    const netByToken = new Map<string, { net: bigint; receiptId: string }>();

    for (const transfer of transfers) {
      const existing = netByToken.get(transfer.tokenId);
      const amount = BigInt(transfer.amountRaw);
      const signedAmount = transfer.direction === "in" ? amount : -amount;

      if (existing) {
        netByToken.set(transfer.tokenId, {
          net: existing.net + signedAmount,
          receiptId: existing.receiptId,
        });
      } else {
        netByToken.set(transfer.tokenId, {
          net: signedAmount,
          receiptId: transfer.receiptId,
        });
      }
    }

    const result: SwapResultModalInfoTransfer[] = [];
    for (const [tokenId, { net, receiptId }] of netByToken) {
      result.push({
        tokenId,
        amountRaw: (net < 0n ? -net : net).toString(),
        direction: net > 0n ? "in" : "out",
        receiptId,
      });
    }

    return result;
  }

  function getTokenById(tokenId: string): Token | null {
    if (inputToken?.account_id === tokenId) return inputToken;
    if (outputToken?.account_id === tokenId) return outputToken;
    return $tokenHubStore.tokensById[tokenId] ?? null;
  }

  function getTokenSymbol(tokenId: string): string | null {
    return getTokenById(tokenId)?.metadata.symbol ?? null;
  }

  function getTokenDecimals(tokenId: string): number | null {
    return getTokenById(tokenId)?.metadata.decimals ?? null;
  }

  function formatTransferAmount(
    amountRaw: string,
    tokenId: string,
  ): string | null {
    const decimals = getTokenDecimals(tokenId);
    if (decimals === null) return null;
    const humanAmount = rawAmountToHumanReadable(amountRaw, decimals);
    const num = parseFloat(humanAmount);
    if (isNaN(num)) return null;
    return formatAmount(num);
  }

  function getConversionEstimatedOutputAmount(route: Route, tokenId: string): string {
    const raw = route.estimated_amount.amount_out;
    if (!raw) return "?";
    return formatTransferAmount(raw, tokenId) ?? "?";
  }

  function resetSuccessStepTwoState() {
    successStepOneInputTransfer = null;
    successStepTwoIncomingTransfer = null;
    successStepTwoTargetTokenId = null;
    successStepTwoRoute = null;
    isFetchingSuccessStepTwoRoute = false;
    isExecutingSuccessStepTwoRoute = false;
  }

  function closeSuccessModal() {
    showSuccessModal = false;
    resetSuccessStepTwoState();
  }

  function getSuccessStepTwoConvertLabel(): string {
    if (
      !successStepTwoIncomingTransfer ||
      !successStepTwoTargetTokenId ||
      !successStepTwoRoute
    ) {
      return "Conversion route unavailable";
    }

    const fromAmount =
      formatTransferAmount(
        successStepTwoIncomingTransfer.amountRaw,
        successStepTwoIncomingTransfer.tokenId,
      ) ?? "?";
    const fromSymbol = getTokenSymbol(successStepTwoIncomingTransfer.tokenId) ?? "?";
    const toAmount = getConversionEstimatedOutputAmount(
      successStepTwoRoute,
      successStepTwoTargetTokenId,
    );
    const toSymbol = getTokenSymbol(successStepTwoTargetTokenId) ?? "?";
    return `Convert ${fromAmount} ${fromSymbol} to ${toAmount} ${toSymbol}`;
  }

  function getSuccessStepTwoKeepLabel(): string {
    if (!successStepTwoIncomingTransfer) return "Done";
    const amount =
      formatTransferAmount(
        successStepTwoIncomingTransfer.amountRaw,
        successStepTwoIncomingTransfer.tokenId,
      ) ?? "?";
    const symbol = getTokenSymbol(successStepTwoIncomingTransfer.tokenId) ?? "?";
    return `Keep ${amount} ${symbol}`;
  }

  function getSuccessModalTitle(): string {
    if (successStepTwoIncomingTransfer && successStepTwoTargetTokenId) {
      return "You Swapped (step 1/2)";
    }
    return "You Swapped";
  }

  function buildTransactionsFromRoute(route: Route) {
    return route.execution_instructions
      .filter(
        (instruction): instruction is NearTransaction =>
          "NearTransaction" in instruction,
      )
      .map((instruction) => {
        const tx = instruction.NearTransaction;

        // Convert actions to near-connect format (js object in args)
        const actions = tx.actions.map((action) => {
          if ("FunctionCall" in action) {
            const fc = action.FunctionCall;
            return {
              type: "FunctionCall",
              params: {
                methodName: fc.method_name,
                args: JSON.parse(atob(fc.args)),
                gas: fc.gas.toString(),
                deposit: fc.deposit,
              },
            };
          }
          console.error("Unsupported action type:", action);
          throw new Error(
            "Unsupported action type. Please report this issue to support.",
          );
        });

        return {
          receiverId: tx.receiver_id,
          actions,
        };
      });
  }

  function assertOutcomesHaveNoFailures(outcomes: unknown) {
    if (!outcomes || !Array.isArray(outcomes)) return;

    // Check all receipt outcomes for errors
    for (const outcome of outcomes) {
      if (!outcome) continue;
      const receiptsOutcome = (
        outcome as { receipts_outcome?: unknown[] }
      ).receipts_outcome;
      if (!receiptsOutcome || !Array.isArray(receiptsOutcome)) continue;
      for (const receiptOutcome of receiptsOutcome) {
        const status = (receiptOutcome as { outcome?: { status?: any } }).outcome
          ?.status;
        if (status?.Failure) {
          const executionError =
            status.Failure?.ActionError?.kind?.FunctionCallError?.ExecutionError;
          if (
            [
              "Smart contract panicked: Output amount is less than constraint",
              "Smart contract panicked: Input amount is greater than constraint",
              "Smart contract panicked: E68: slippage error",
            ].some((error) => error.includes(executionError))
          ) {
            throw new Error(
              "Slippage error: The price has changed while you were confirming transaction. Please try again.",
            );
          }
          throw new Error(executionError || JSON.stringify(status.Failure));
        }
      }
    }
  }

  async function fetchOneShotExactInRoute(
    tokenInId: string,
    tokenOutId: string,
    amountInRaw: string,
  ): Promise<Route | null> {
    const params = new URLSearchParams({
      token_in: getTokenIdForRouter(tokenInId),
      token_out: getTokenIdForRouter(tokenOutId),
      max_wait_ms: "1500",
      dexes: "Rhea,RheaDcl,Aidols,Wrap,MetaPool,Linear,XRhea,RNear,Plach",
    });

    if (swapSlippageMode === "auto") {
      params.set("slippage_type", "Auto");
      params.set("min_slippage", (AUTO_MIN_SLIPPAGE_PERCENT / 100).toFixed(3));
      params.set("max_slippage", (AUTO_MAX_SLIPPAGE_PERCENT / 100).toFixed(3));
    } else {
      params.set("slippage_type", "Fixed");
      params.set("slippage", String(swapSlippageValue / 100));
    }

    params.set("amount_in", amountInRaw);

    if ($walletStore.accountId) {
      params.set("trader_account_id", $walletStore.accountId);
    }

    const response = await fetch(`${ROUTER_API}/route?${params}`);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `HTTP ${response.status}`);
    }

    const routes: Route[] = await response.json();
    const validRoutes = routes.filter((route) =>
      route.execution_instructions.every((instr) => "NearTransaction" in instr),
    );
    return validRoutes[0] ?? null;
  }

  async function fetchSuccessStepTwoRoute(
    incomingTransfer: SwapResultModalInfoTransfer,
    targetTokenId: string,
  ) {
    isFetchingSuccessStepTwoRoute = true;
    successStepTwoRoute = null;
    try {
      successStepTwoRoute = await fetchOneShotExactInRoute(
        incomingTransfer.tokenId,
        targetTokenId,
        incomingTransfer.amountRaw,
      );
    } catch (error) {
      console.error("Failed to fetch step-2 route:", error);
    } finally {
      isFetchingSuccessStepTwoRoute = false;
    }
  }

  async function handleConvertFromSuccessModal() {
    if (
      !successStepTwoIncomingTransfer ||
      !successStepTwoTargetTokenId ||
      !successStepTwoRoute
    ) {
      return;
    }
    if (
      !$walletStore.isConnected ||
      !$walletStore.wallet ||
      !$walletStore.accountId
    ) {
      return;
    }

    const accountId = $walletStore.accountId;
    const stepTwoRoute = successStepTwoRoute;
    const stepOneInputTransfer = successStepOneInputTransfer;

    if (!accountId || !stepTwoRoute) {
      return;
    }

    isExecutingSuccessStepTwoRoute = true;
    try {
      const transactions = buildTransactionsFromRoute(stepTwoRoute);
      const outcomes = await $walletStore.wallet.signAndSendTransactions({
        transactions,
      });
      tokenHubStore.refreshBalances();
      assertOutcomesHaveNoFailures(outcomes);

      const stepTwoTransfers: SwapResultModalInfoTransfer[] = [];
      if (Array.isArray(outcomes)) {
        for (const outcome of outcomes) {
          if (outcome) {
            stepTwoTransfers.push(...extractTransfersFromOutcome(outcome, accountId));
          }
        }
      }

      const consolidatedStepTwoTransfers = consolidateTransfers(stepTwoTransfers);
      const stepTwoDetectedOutputTokenId = assetIdToTokenId(stepTwoRoute.token_output);
      const stepTwoOutputTransfer =
        (stepTwoDetectedOutputTokenId
          ? (consolidatedStepTwoTransfers.find(
              (transfer) =>
                transfer.direction === "in" &&
                transfer.tokenId === stepTwoDetectedOutputTokenId,
            ) ?? null)
          : null) ??
        (consolidatedStepTwoTransfers.find(
          (transfer) => transfer.direction === "in",
        ) ?? null);

      if (stepOneInputTransfer && stepTwoOutputTransfer) {
        successTransfers = [stepOneInputTransfer, stepTwoOutputTransfer];
      } else {
        console.error(
          "Could not build final success transfers after step 2.",
          "Step 1 input transfer:",
          stepOneInputTransfer,
          "Step 2 transfers:",
          consolidatedStepTwoTransfers,
        );
      }

      resetSuccessStepTwoState();
      showSuccessModal = true;
    } catch (error) {
      console.error("Step-2 conversion failed:", error);
      errorMessage = error instanceof Error ? error.message : "Unknown error";
      showErrorModal = true;
    } finally {
      isExecutingSuccessStepTwoRoute = false;
    }
  }

  async function handleSwap() {
    if (
      !$walletStore.isConnected ||
      !$walletStore.wallet ||
      !$walletStore.accountId
    ) {
      return;
    }

    if (!inputToken || !outputToken) {
      errorMessage = "Please select both tokens";
      console.error(errorMessage);
      showErrorModal = true;
      return;
    }

    if (!currentRoute) {
      errorMessage = "No route available. Please wait for a quote.";
      console.error(errorMessage);
      showErrorModal = true;
      return;
    }

    const userTypedAmount =
      swapMode === "exactIn"
        ? inputAmountHumanReadable
        : outputAmountHumanReadable;
    const hasValidAmount = userTypedAmount && parseFloat(userTypedAmount) > 0;

    if (!hasValidAmount) {
      return;
    }

    const routeAtSwap = currentRoute;
    const userRequestedOutputTokenId = outputToken.account_id;
    const routeOutputTokenId = assetIdToTokenId(routeAtSwap.token_output);
    const isTwoStepSwap =
      routeOutputTokenId !== null &&
      routeOutputTokenId !== userRequestedOutputTokenId;

    isSwapping = true;
    const allTransfers: SwapResultModalInfoTransfer[] = [];

    try {
      const wallet = $walletStore.wallet;
      const accountId = $walletStore.accountId;
      if (!wallet || !accountId) {
        throw new Error("Wallet is not connected");
      }

      const transactions = buildTransactionsFromRoute(routeAtSwap);
      const outcomes = await wallet.signAndSendTransactions({ transactions });
      tokenHubStore.refreshBalances();

      console.log("Transaction results:", outcomes);
      assertOutcomesHaveNoFailures(outcomes);

      if (Array.isArray(outcomes)) {
        for (const outcome of outcomes) {
          if (outcome) {
            const transfers = extractTransfersFromOutcome(outcome, accountId);
            for (const transfer of transfers) {
              console.log("Transfer detected:", transfer);
            }
            allTransfers.push(...transfers);
          }
        }
      }

      if (routeAtSwap.needs_unwrap) {
        console.error("Manual unwrap may be needed, but not implemented yet.");
      }

      console.log("Transfers found:", allTransfers);

      inputAmountHumanReadable = "";
      outputAmountHumanReadable = "";
      availableRoutes = [];
      currentRoute = null;

      const consolidatedTransfers = consolidateTransfers(allTransfers);
      const stepOneInputTransfer =
        consolidatedTransfers.find(
          (transfer) =>
            transfer.direction === "out" && transfer.tokenId === inputToken.account_id,
        ) ?? null;
      const stepTwoIncomingTransfer =
        isTwoStepSwap && routeOutputTokenId
          ? (consolidatedTransfers.find(
              (transfer) =>
                transfer.direction === "in" &&
                transfer.tokenId === routeOutputTokenId,
            ) ?? null)
          : null;

      // Keep only swap-relevant tokens, including intermediate token_output for
      // two-step routes.
      const swapRelevantTokenIds = new Set<string>([
        inputToken.account_id,
        userRequestedOutputTokenId,
      ]);
      if (routeOutputTokenId) {
        swapRelevantTokenIds.add(routeOutputTokenId);
      }
      const relevantTransfers = consolidatedTransfers.filter((t) =>
        swapRelevantTokenIds.has(t.tokenId),
      );

      if (relevantTransfers.length >= 2) {
        successTransfers = relevantTransfers;
        resetSuccessStepTwoState();
        successStepOneInputTransfer = stepOneInputTransfer;
        if (stepTwoIncomingTransfer) {
          successStepTwoIncomingTransfer = stepTwoIncomingTransfer;
          successStepTwoTargetTokenId = userRequestedOutputTokenId;
          void fetchSuccessStepTwoRoute(
            stepTwoIncomingTransfer,
            userRequestedOutputTokenId,
          );
        }
        showSuccessModal = true;
      } else {
        // Couldn't extract transfers, log for debugging
        console.error(
          "Could not extract transfer amounts from transaction results. Extracted:",
          relevantTransfers,
          "All transfers:",
          allTransfers,
          "Outcomes:",
          outcomes,
        );
      }
    } catch (error) {
      console.error("Swap failed:", error);
      errorMessage = error instanceof Error ? error.message : "Unknown error";
      showErrorModal = true;
    } finally {
      isSwapping = false;
    }
  }

  async function handleConnectWallet() {
    try {
      await walletStore.connect();
    } catch (error) {
      console.error("Connection failed:", error);
    }
  }

  function switchTokens() {
    [inputTokenId, outputTokenId] = [outputTokenId, inputTokenId];

    availableRoutes = [];
    currentRoute = null;
    if (swapMode === "exactIn") {
      swapMode = "exactOut";
      outputAmountHumanReadable = inputAmountHumanReadable;
      inputAmountHumanReadable = "";
    } else {
      swapMode = "exactIn";
      inputAmountHumanReadable = outputAmountHumanReadable;
      outputAmountHumanReadable = "";
    }
  }

  function handleSelectInputToken(token: Token) {
    // If selecting the same token as output, flip them
    if (outputTokenId && token.account_id === outputTokenId) {
      outputTokenId = inputTokenId;
    }
    inputTokenId = token.account_id;
  }

  function handleSelectOutputToken(token: Token) {
    // If selecting the same token as input, flip them
    if (inputTokenId && token.account_id === inputTokenId) {
      inputTokenId = outputTokenId;
    }
    outputTokenId = token.account_id;
  }

  function getEffectiveBalance(): bigint | null {
    if (!inputToken || !inputTokenBalance) return null;
    let balanceRaw = BigInt(inputTokenBalance);
    if (inputToken.account_id === "near") {
      const gasReserve = BigInt(
        humanReadableToRawAmount("0.03", inputToken.metadata.decimals),
      );
      balanceRaw = balanceRaw > gasReserve ? balanceRaw - gasReserve : 0n;
    }
    return balanceRaw;
  }

  function computePresetAmount(preset: AmountPreset): string | null {
    if (!inputToken) return null;
    if (preset.type === "percent") {
      const balanceRaw = getEffectiveBalance();
      if (balanceRaw === null) return null;
      const scaled = (balanceRaw * BigInt(preset.value)) / 100n;
      return rawAmountToHumanReadable(
        scaled.toString(),
        inputToken.metadata.decimals,
      );
    } else {
      const price = parseFloat(inputToken.price_usd);
      if (!price || price <= 0) return null;
      const tokenAmount = preset.value / price;
      const rawAmount = humanReadableToRawAmount(
        tokenAmount.toFixed(inputToken.metadata.decimals),
        inputToken.metadata.decimals,
      );
      return rawAmountToHumanReadable(rawAmount, inputToken.metadata.decimals);
    }
  }

  function applyPreset(preset: AmountPreset) {
    const amount = computePresetAmount(preset);
    if (amount === null) return;
    inputAmountHumanReadable = amount;
    swapMode = "exactIn";
  }

  const activePresetIndex = $derived.by(() => {
    if (!inputToken || swapMode !== "exactIn") return null;
    if (!inputAmountHumanReadable) return null;
    for (let i = 0; i < amountPresets.length; i++) {
      const expected = computePresetAmount(amountPresets[i]);
      if (expected !== null && inputAmountHumanReadable === expected) return i;
    }
    return null;
  });

  const inputBalanceUsd = $derived.by(() => {
    const balance = getEffectiveBalance();
    if (balance === null || !inputToken) return 0;
    const human = rawAmountToHumanReadable(
      balance.toString(),
      inputToken.metadata.decimals,
    );
    const price = parseFloat(inputToken.price_usd);
    const usd = parseFloat(human) * price;
    return Number.isFinite(usd) ? usd : 0;
  });

  function truncateSymbol(symbol: string): string {
    if (symbol.length >= 8) return symbol.slice(0, 6) + "\u2026";
    return symbol;
  }
</script>

<p class="subtitle">{randomPhrase}</p>

<div class="swap-card" class:disabled={!$walletStore.isConnected}>
  <TradeSettingsRow
    bind:open={swapSettingsOpen}
    settingsLabel={swapSettingsDisplay}
    dialogLabel="Swap settings"
    closeBackdropLabel="Close swap settings"
  >
    {#snippet presets()}
      {#if presetsVisible && $walletStore.isConnected && inputToken && inputTokenBalance}
        {@const inputPrice = parseFloat(inputToken.price_usd)}
        <DexPresetButtons
          items={amountPresets.reduce((buttons, preset, i) => {
            if (preset.type === "percent" || inputPrice > 0) {
              const insufficientDollar =
                preset.type === "dollar" &&
                (inputBalanceUsd <= 0 || preset.value > inputBalanceUsd);
              buttons.push({
                id: i,
                label:
                  preset.type === "dollar"
                    ? `$${preset.value}`
                    : `${preset.value}%`,
                active: activePresetIndex === i,
                disabled: insufficientDollar,
                insufficientDollar,
                onClick: () => applyPreset(preset),
              });
            }
            return buttons;
          }, [] as DexPresetButtonItem[])}
        />
      {/if}
    {/snippet}
    <SwapSettings
      mode={swapSlippageMode}
      value={swapSlippageValue}
      onchange={handleSlippageChange}
      {presetsVisible}
      presets={amountPresets}
      onPresetsChange={handlePresetsChange}
    />
  </TradeSettingsRow>

  <div class="swap-fields">
    <div
      class="input-wrapper"
      class:loading={isFetchingRoute && swapMode === "exactOut"}
      class:insufficient-balance={hasInsufficientBalance}
    >
      <div class="input-header">
        <label for="input-amount"
          >You pay {#if isFetchingRoute && swapMode === "exactOut"}<span
              class="fetching-indicator"
            ></span>{/if}</label
        >
        {#if $walletStore.isConnected && inputToken && formattedInputBalance !== null}
          <button
            class="balance-display clickable"
            onclick={() => {
              if (formattedInputBalance && inputToken) {
                // Subtract 0.03 NEAR as gas reserve
                if (inputToken.account_id === "near") {
                  const balanceRaw = BigInt(inputTokenBalance || "0");
                  const gasReserve = BigInt(
                    humanReadableToRawAmount(
                      "0.03",
                      inputToken.metadata.decimals,
                    ),
                  );
                  const availableBalance =
                    balanceRaw > gasReserve ? balanceRaw - gasReserve : 0n;
                  inputAmountHumanReadable = rawAmountToHumanReadable(
                    availableBalance.toString(),
                    inputToken.metadata.decimals,
                  );
                } else {
                  inputAmountHumanReadable = rawAmountToHumanReadable(
                    inputTokenBalance || "0",
                    inputToken.metadata.decimals,
                  );
                }
                swapMode = "exactIn";
              }
            }}
          >
            Balance: {formattedInputBalance}
          </button>
        {/if}
      </div>
      <div class="amount-row">
        <div class="amount-column">
          <input
            id="input-amount"
            type="text"
            placeholder="0.00"
            value={getFormattedInputAmount()}
            oninput={(e) => {
              swapMode = "exactIn";
              inputAmountHumanReadable = e.currentTarget.value.replaceAll(
                ",",
                "",
              );
            }}
            min="0"
            step="any"
            disabled={!$walletStore.isConnected}
            class:estimated-amount={swapMode === "exactOut"}
            class:insufficient-balance={hasInsufficientBalance}
          />
          {#if inputUsdValue}
            <span class="usd-value">{inputUsdValue}</span>
          {:else if isFetchingRoute}
            <span class="usd-value skeleton-text" style="width: 8rem"
              >&nbsp;</span
            >
          {:else}
            <span class="usd-value" style="width: 8rem">&nbsp;</span>
          {/if}
        </div>
        <button
          class="token-select"
          disabled={!$walletStore.isConnected}
          onclick={() => (inputTokenSelectorOpen = true)}
        >
          {#if inputToken}
            <TokenIcon token={inputToken} size={24} showBadge badgeSmall />
            <span class="token-symbol"
              >{truncateSymbol(inputToken.metadata.symbol)}</span
            >
          {:else}
            Select
          {/if}
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
    </div>

    <button
      class="switch-btn"
      onclick={switchTokens}
      aria-label="Switch tokens"
      disabled={!$walletStore.isConnected}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M7 16V4M7 4L3 8M7 4L11 8" />
        <path d="M17 8V20M17 20L21 16M17 20L13 16" />
      </svg>
    </button>

    <div
      class="input-wrapper"
      class:loading={isFetchingRoute && swapMode === "exactIn"}
    >
      <div class="input-header">
        <label for="output-amount"
          >You receive {#if isFetchingRoute && swapMode === "exactIn"}<span
              class="fetching-indicator"
            ></span>{/if}</label
        >
        {#if $walletStore.isConnected && outputToken && formattedOutputBalance !== null}
          <span class="balance-display">Balance: {formattedOutputBalance}</span>
        {/if}
      </div>
      <div class="amount-row">
        <div class="amount-column">
          <input
            id="output-amount"
            type="text"
            placeholder="0.00"
            value={getFormattedOutputAmount()}
            oninput={(e) => {
              swapMode = "exactOut";
              outputAmountHumanReadable = e.currentTarget.value.replaceAll(
                ",",
                "",
              );
            }}
            disabled={!$walletStore.isConnected}
            class:estimated-amount={swapMode === "exactIn"}
          />
          {#if outputUsdValue}
            <span class="usd-value">{outputUsdValue}</span>
          {:else if isFetchingRoute}
            <span class="usd-value skeleton-text" style="width: 8rem"
              >&nbsp;</span
            >
          {:else}
            <span class="usd-value" style="width: 8rem">&nbsp;</span>
          {/if}
        </div>
        <button
          class="token-select"
          disabled={!$walletStore.isConnected}
          onclick={() => (outputTokenSelectorOpen = true)}
        >
          {#if outputToken}
            <TokenIcon token={outputToken} size={24} showBadge badgeSmall />
            <span class="token-symbol"
              >{truncateSymbol(outputToken.metadata.symbol)}</span
            >
          {:else}
            Select
          {/if}
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
    </div>
  </div>

  {#if currentRoute && inputToken && outputToken}
    {@const worstCase = getWorstCaseDisplay()}
    <div class="route-info">
      {#if worstCase}
        <div class="route-row">
          <span class="route-label">{worstCase.label}</span>
          <span class="route-value">{worstCase.value} {worstCase.symbol}</span>
        </div>
      {/if}
      <div class="route-row">
        <span class="route-label">Route via</span>
        <div class="route-badge-stack">
          <button
            type="button"
            class="route-provider-btn route-segment route-segment-dex"
            onclick={openRoutePicker}
            aria-label="Select route provider"
            aria-haspopup="dialog"
          >
            <span>{displayedRouteDexId}</span>
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {#if !isRouteFixed || isCurrentRouteBest}
            <span class="route-segment route-segment-best">Best</span>
          {:else if selectedRoutePenaltyPercent !== null}
            <span class="route-segment route-segment-penalty"
              >-{formatPenaltyPercent(selectedRoutePenaltyPercent)}%</span
            >
          {/if}

          {#if isRouteFixed}
            <button
              type="button"
              class="route-unfix-btn route-segment route-segment-clear"
              onclick={clearFixedRouteSelection}
              aria-label="Clear fixed route"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              >
                <path d="M18 6L6 18" />
                <path d="M6 6L18 18" />
              </svg>
            </button>
          {/if}
        </div>
      </div>
      {#if isTwoStepRoute}
        <div class="route-row two-step-route-note">
          <span class="route-label"></span>
          <span class="route-value two-step-route-note-text"
            >Two-step route</span
          >
        </div>
      {/if}
    </div>
  {:else if isFetchingRoute && inputToken && outputToken}
    <div class="route-info">
      <div class="route-row">
        <span class="route-label" style="width: 6rem"
          >{swapMode === "exactIn" ? "Min. received" : "Max. paid"}</span
        >
        <span class="route-value skeleton-text" style="width: 8rem">&nbsp;</span
        >
      </div>
      <div class="route-row">
        <span class="route-label" style="width: 4.5rem">Route via</span>
        <span class="skeleton-badge" style="width: 4.5rem">&nbsp;</span>
      </div>
    </div>
  {:else if !currentRoute && !isFetchingRoute && (swapMode === "exactIn" ? inputAmountHumanReadable && parseFloat(inputAmountHumanReadable) > 0 : outputAmountHumanReadable && parseFloat(outputAmountHumanReadable) > 0)}
    <div class="route-info">
      <div class="route-row">
        <span class="route-label"
          >{swapMode === "exactIn" ? "Min. received" : "Max. paid"}</span
        >
        <span class="route-value no-route">No Route</span>
      </div>
      <div class="route-row">
        <span class="route-label">Route via</span>
        {#if isRouteFixed}
          <div class="route-badge-stack">
            <button
              type="button"
              class="route-provider-btn route-segment route-segment-dex"
              onclick={openRoutePicker}
              disabled={availableRoutes.length === 0}
              aria-label="Select route provider"
              aria-haspopup="dialog"
            >
              <span>{displayedRouteDexId}</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            <button
              type="button"
              class="route-unfix-btn route-segment route-segment-clear"
              onclick={clearFixedRouteSelection}
              aria-label="Clear fixed route"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              >
                <path d="M18 6L6 18" />
                <path d="M6 6L18 18" />
              </svg>
            </button>
          </div>
        {:else}
          <span class="route-value dex-badge">None</span>
        {/if}
      </div>
    </div>
  {/if}

  {#if showPriceImpactWarning}
    <div
      id="swap-price-impact-warning"
      class="price-impact-warning"
      class:severe={priceImpactSevere}
      role="alert"
      aria-live="polite"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path
          d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
        />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
      <span
        >Price impact is high: you will receive <strong
          >{priceImpact?.toFixed(2)}%</strong
        > less than you pay</span
      >
    </div>
  {/if}

  {#if !$walletStore.isConnected}
    <button class="swap-btn connect-wallet-btn" onclick={handleConnectWallet}>
      Connect Wallet
    </button>
  {:else}
    {@const hasValidAmount =
      swapMode === "exactIn"
        ? inputAmountHumanReadable && parseFloat(inputAmountHumanReadable) > 0
        : outputAmountHumanReadable &&
          parseFloat(outputAmountHumanReadable) > 0}
    <button
      class="swap-btn"
      onclick={handleSwap}
      aria-describedby={showPriceImpactWarning
        ? "swap-price-impact-warning"
        : undefined}
      disabled={!hasValidAmount ||
        isSwapping ||
        !inputToken ||
        !outputToken ||
        !currentRoute ||
        isFetchingRoute ||
        hasInsufficientBalance}
    >
      {#if isSwapping}
        <Spinner tone="light" />
        Swapping...
      {:else if isFetchingRoute}
        <Spinner tone="light" />
        Getting quote...
      {:else if hasInsufficientBalance}
        Insufficient balance
      {:else if !currentRoute && hasValidAmount}
        No route found
      {:else}
        Swap
      {/if}
    </button>
  {/if}
</div>

<TokenSelector
  isOpen={inputTokenSelectorOpen}
  onClose={() => (inputTokenSelectorOpen = false)}
  onSelectToken={handleSelectInputToken}
/>

<TokenSelector
  isOpen={outputTokenSelectorOpen}
  onClose={() => (outputTokenSelectorOpen = false)}
  onSelectToken={handleSelectOutputToken}
/>

<ErrorModal
  isOpen={showErrorModal}
  onClose={() => (showErrorModal = false)}
  title="Swap Failed"
  message={errorMessage}
  isTransaction={true}
/>

<!-- Success Modal -->
<ModalShell
  isOpen={showSuccessModal}
  onClose={closeSuccessModal}
  modalClassName="success-modal"
  dialogLabel="Swap complete"
>
  <div class="modal-icon success-icon">
    <svg
      width="48"
      height="48"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  </div>
  <h3 class="modal-title">{getSuccessModalTitle()}</h3>
  <div class="transfers-list">
    {#each successTransfers as transfer}
      <div
        class="transfer-item"
        class:transfer-in={transfer.direction === "in"}
        class:transfer-out={transfer.direction === "out"}
      >
        <span class="transfer-direction"
          >{transfer.direction === "in" ? "+" : "−"}</span
        >
        <span class="transfer-amount"
          >{formatTransferAmount(transfer.amountRaw, transfer.tokenId) ??
            "?"}</span
        >
        <span class="transfer-symbol"
          >{getTokenSymbol(transfer.tokenId) ?? "?"}</span
        >
      </div>
    {/each}
  </div>
  {#if successStepTwoIncomingTransfer && successStepTwoTargetTokenId}
    <button
      class="modal-btn success-btn"
      onclick={handleConvertFromSuccessModal}
      disabled={
        isFetchingSuccessStepTwoRoute ||
        isExecutingSuccessStepTwoRoute ||
        !successStepTwoRoute
      }
    >
      {#if isExecutingSuccessStepTwoRoute}
        Converting...
      {:else if isFetchingSuccessStepTwoRoute}
        Preparing conversion route...
      {:else}
        {getSuccessStepTwoConvertLabel()}
      {/if}
    </button>
    <button
      class="modal-btn keep-btn"
      onclick={closeSuccessModal}
      disabled={isExecutingSuccessStepTwoRoute}
    >
      {getSuccessStepTwoKeepLabel()}
    </button>
  {:else}
    <button class="modal-btn success-btn" onclick={closeSuccessModal}>
      Done
    </button>
  {/if}
</ModalShell>

<ModalShell
  isOpen={isRoutePickerOpen}
  onClose={() => (isRoutePickerOpen = false)}
  modalClassName="route-picker-modal"
  dialogLabel="Select route provider"
>
  <div class="route-picker-header">
    <h3 class="route-picker-title">Select route provider</h3>
    <button
      type="button"
      class="route-picker-close-btn"
      onclick={() => (isRoutePickerOpen = false)}
      aria-label="Close route provider picker"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      >
        <path d="M18 6L6 18" />
        <path d="M6 6L18 18" />
      </svg>
    </button>
  </div>

  <div class="route-picker-body">
    {#if availableRoutes.length === 0}
      <p class="route-picker-empty">No routes available yet.</p>
    {:else}
      <div class="route-picker-list">
        {#each availableRoutes as route, routeIndex (`${route.dex_id}-${routeIndex}`)}
          {@const isBestInList = routeIndex === 0}
          {@const isFixedInList = fixedRouteDexId === route.dex_id}
          {@const isSelectedRoute = currentRoute
            ? currentRoute.dex_id === route.dex_id
            : isFixedInList}
          {@const routePenalty =
            bestRoute && !isBestInList
              ? calculateRoutePenaltyPercent(route, bestRoute)
              : null}
          <button
            type="button"
            class="route-picker-item"
            class:selected={isSelectedRoute}
            onclick={() => handleSelectFixedRoute(route)}
            aria-pressed={isSelectedRoute}
          >
            <div class="route-picker-item-main">
              <span class="route-picker-provider">{route.dex_id}</span>
            </div>
            <div class="route-picker-item-right">
              <span class="route-picker-amount"
                >{formatRoutePreviewAmount(route)}</span
              >
              <div class="route-picker-item-badges">
                {#if isBestInList}
                  <span
                    class="route-picker-status-badge route-picker-status-best"
                    >Best</span
                  >
                {:else if routePenalty !== null}
                  <span
                    class="route-picker-status-badge route-picker-status-penalty"
                    >-{formatPenaltyPercent(routePenalty)}%</span
                  >
                {/if}
              </div>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</ModalShell>

<style>
  .subtitle {
    margin: 0.5rem 0 0;
    color: var(--text-secondary);
    font-size: 1rem;
    font-weight: 400;
  }

  .swap-card {
    width: 100%;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 1.25rem;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    position: relative;
    box-shadow:
      0 4px 6px -1px rgba(0, 0, 0, 0.3),
      0 2px 4px -2px rgba(0, 0, 0, 0.2),
      0 0 0 1px rgba(59, 130, 246, 0.05);
  }

  .swap-card.disabled .input-wrapper {
    opacity: 0.6;
  }

  .swap-card.disabled .switch-btn {
    opacity: 0.6;
  }

  .swap-card.disabled .route-info {
    opacity: 0.6;
  }

  .swap-fields {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .input-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  label {
    font-size: 0.875rem;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .balance-display {
    font-size: 0.8125rem;
    color: var(--text-muted);
    font-family: "JetBrains Mono", monospace;
    background: none;
    border: none;
    padding: 0;
    margin: 0;
  }

  .balance-display.clickable {
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .balance-display.clickable:hover {
    color: var(--accent-primary);
  }

  .input-wrapper {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 0.875rem;
    padding: 0.875rem 1rem;
    transition:
      border-color 0.2s ease,
      box-shadow 0.2s ease;
  }

  .input-wrapper:focus-within {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 3px var(--accent-glow);
  }

  .amount-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .amount-column {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    gap: 0.125rem;
  }

  input {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-primary);
    min-width: 0;
  }

  .usd-value {
    font-size: 0.8125rem;
    color: var(--text-muted);
    font-family: "JetBrains Mono", monospace;
  }

  input:disabled {
    cursor: not-allowed;
    opacity: 0.7;
  }

  input.estimated-amount {
    color: var(--text-secondary);
  }

  input.insufficient-balance {
    color: var(--status-error-text);
  }

  .input-wrapper.insufficient-balance {
    border-color: var(--status-error-soft-border);
  }

  .input-wrapper.insufficient-balance:focus-within {
    border-color: var(--status-error-text);
    box-shadow: 0 0 0 3px var(--status-error-soft-bg);
  }

  input::placeholder {
    color: var(--text-muted);
  }

  .token-select {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.875rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 0.625rem;
    color: var(--text-primary);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .token-select:hover:not(:disabled) {
    background: var(--bg-card);
    border-color: var(--accent-primary);
  }

  .token-select:disabled {
    cursor: not-allowed;
    opacity: 0.7;
  }

  .token-select svg {
    color: var(--text-secondary);
    transition: transform 0.2s ease;
  }

  .token-symbol {
    font-family: "JetBrains Mono", monospace;
    font-weight: 700;
  }

  .switch-btn {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 2.5rem;
    height: 2.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-secondary);
    border: 3px solid var(--bg-card);
    border-radius: 0.75rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
    z-index: 10;
  }

  .switch-btn:hover:not(:disabled) {
    color: var(--accent-primary);
    background: var(--bg-input);
    transform: translate(-50%, -50%) rotate(180deg);
  }

  .switch-btn:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .swap-btn {
    width: 100%;
    padding: 1rem;
    margin-top: 0.5rem;
    background: var(--accent-button);
    border: none;
    border-radius: 0.875rem;
    color: var(--text-on-accent);
    font-size: 1.25rem;
    font-weight: bold;
    cursor: pointer;
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }

  .swap-btn:hover:not(:disabled):not(.connect-wallet-btn) {
    background: var(--accent-hover);
  }

  .swap-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .swap-btn:active:not(:disabled) {
    transform: scale(0.98);
  }

  .connect-wallet-btn {
    background: linear-gradient(
      135deg,
      var(--accent-gradient-start),
      var(--accent-gradient-end)
    );
  }

  .connect-wallet-btn:hover:not(:disabled) {
    background: linear-gradient(
      135deg,
      var(--accent-gradient-hover-start),
      var(--accent-gradient-hover-end)
    );
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .input-wrapper.loading {
    opacity: 0.7;
  }

  .input-wrapper.loading input {
    color: var(--text-secondary);
  }

  .fetching-indicator {
    display: inline-block;
    width: 10px;
    height: 10px;
    border: 2px solid var(--text-muted);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-left: 0.5rem;
    vertical-align: middle;
  }

  .route-info {
    --route-badge-height: 1.625rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.875rem 1rem;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
  }

  .route-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .route-label {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .route-value {
    font-size: 0.8125rem;
    color: var(--text-primary);
    font-weight: 500;
    font-family: "JetBrains Mono", monospace;
  }

  .route-value.no-route {
    color: var(--text-muted);
  }

  .route-row.two-step-route-note {
    margin-top: -0.25rem;
  }

  .two-step-route-note-text {
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--text-secondary);
  }

  .route-badge-stack {
    display: inline-flex;
    justify-content: flex-end;
    align-items: stretch;
    flex-wrap: nowrap;
    gap: 0;
    max-width: 72%;
    height: var(--route-badge-height);
    overflow: hidden;
  }

  .route-badge-stack > .route-segment {
    position: relative;
    border-radius: 0;
  }

  .route-badge-stack > .route-segment:not(:first-child) {
    padding-left: 0.6rem;
    position: relative;
    left: -0.3rem;
    border-radius: 0 1rem 1rem 0;
  }

  .route-badge-stack > .route-segment:not(:first-child)::before {
    content: "";
    position: absolute;
    left: -1.5rem;
    top: 0;
    width: 1.5rem;
    height: 100%;
    background: inherit;
    pointer-events: none;
  }

  .route-badge-stack > .route-segment:first-child {
    border-radius: 1rem;
  }

  .route-badge-stack > .route-segment:nth-child(1) {
    z-index: 100;
  }

  .route-badge-stack > .route-segment:nth-child(2) {
    z-index: 99;
  }

  .route-badge-stack > .route-segment:nth-child(3) {
    z-index: 98;
  }

  .route-badge-stack > .route-segment:nth-child(4) {
    z-index: 97;
  }

  .route-badge-stack > .route-segment:nth-child(5) {
    z-index: 96;
  }

  .route-badge-stack > .route-segment:nth-child(6) {
    z-index: 95;
  }

  .route-segment {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 0 0.68rem;
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1;
    font-family: "JetBrains Mono", monospace;
    white-space: nowrap;
    border: none;
    border-radius: 0;
  }

  .route-segment-dex {
    background: linear-gradient(
      135deg,
      var(--accent-gradient-start),
      var(--accent-gradient-end)
    );
    color: var(--text-on-accent);
  }

  .route-segment-best {
    background: var(--status-success-solid);
    color: var(--text-on-success);
  }

  .route-segment-penalty {
    background: var(--status-warning-solid);
    color: var(--text-on-warning);
  }

  .route-segment-clear {
    background: var(--status-error-solid);
    color: var(--text-on-danger);
    width: var(--route-badge-height);
    padding: 0 0.25rem 0 0 !important;
    flex-shrink: 0;
  }

  .route-provider-btn {
    border: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    line-height: 1;
  }

  .route-provider-btn svg {
    width: 11px;
    height: 11px;
    color: var(--text-on-accent);
  }

  .route-provider-btn:disabled {
    cursor: not-allowed;
    opacity: 0.75;
  }

  .route-provider-btn:focus-visible,
  .route-unfix-btn:focus-visible,
  .route-picker-item:focus-visible,
  .route-picker-close-btn:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: -2px;
  }

  .route-unfix-btn {
    border: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: filter 0.15s ease;
  }

  .route-unfix-btn:hover {
    filter: brightness(1.08);
  }

  :global(.result-modal.route-picker-modal) {
    width: 100%;
    max-width: 520px;
    max-height: 78dvh;
    align-items: stretch;
    gap: 0;
    padding: 0;
    overflow: hidden;
    border-radius: 1.25rem;
  }

  .route-picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .route-picker-title {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .route-picker-close-btn {
    width: 2.25rem;
    height: 2.25rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 0.5rem;
    color: var(--text-secondary);
    background: transparent;
    cursor: pointer;
    transition: background 0.15s ease;
    flex-shrink: 0;
  }

  .route-picker-close-btn:hover {
    background: var(--bg-input);
    color: var(--text-primary);
  }

  .route-picker-body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }

  .route-picker-empty {
    margin: auto;
    color: var(--text-muted);
    font-size: 0.875rem;
    text-align: center;
    padding: 1.25rem 1rem;
  }

  .route-picker-list {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    max-height: 24rem;
    overflow-y: auto;
    width: 100%;
    padding: 0.75rem;
  }

  .route-picker-item {
    width: 100%;
    border: 1px solid var(--border-color);
    border-radius: 0.625rem;
    background: var(--bg-input);
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: 4.25rem;
    padding: 0.8rem 0.9rem;
    text-align: left;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background 0.15s ease;
  }

  .route-picker-item:hover {
    border-color: var(--accent-primary);
  }

  .route-picker-item.selected {
    border-color: var(--accent-primary);
    background: rgba(59, 130, 246, 0.08);
  }

  .route-picker-item-main {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    flex: 1;
  }

  .route-picker-provider {
    font-size: 0.95rem;
    font-weight: 700;
    font-family: "JetBrains Mono", monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .route-picker-item-badges {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-height: 1.25rem;
  }

  .route-picker-item-right {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: center;
    gap: 0.3rem;
    flex-shrink: 0;
  }

  .route-picker-amount {
    font-size: 0.9rem;
    color: var(--text-primary);
    font-weight: 700;
    font-family: "JetBrains Mono", monospace;
    white-space: nowrap;
  }

  .route-picker-status-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 1.2rem;
    padding: 0.1rem 0.45rem;
    border-radius: 0.35rem;
    font-family: "JetBrains Mono", monospace;
    font-size: 0.675rem;
    font-weight: 700;
    line-height: 1;
  }

  .route-picker-status-best {
    background: var(--status-success-solid);
    color: var(--text-on-success);
  }

  .route-picker-status-penalty {
    background: var(--status-warning-solid);
    color: var(--text-on-warning);
  }

  @media (--tablet) {
    :global(.result-modal.route-picker-modal) {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100%;
      max-width: 100%;
      max-height: 92dvh;
      border-radius: 1.1rem 1.1rem 0 0;
      border-bottom: none;
      animation: routePickerSheetIn 0.2s ease-out;
    }

    .route-picker-header {
      padding: 0.9rem 1rem;
    }

    .route-picker-title {
      font-size: 1.05rem;
    }

    .route-picker-list {
      padding: 0.625rem 0.625rem calc(0.625rem + env(safe-area-inset-bottom));
      max-height: none;
    }
  }

  @keyframes routePickerSheetIn {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .price-impact-warning {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: var(--status-warning-soft-bg);
    border: 1px solid var(--status-warning-soft-border);
    border-radius: 0.75rem;
    color: var(--status-warning-text);
    font-size: 0.8125rem;
    font-weight: 500;
  }

  .price-impact-warning svg {
    flex-shrink: 0;
    color: var(--status-warning-text);
  }

  .price-impact-warning strong {
    font-family: "JetBrains Mono", monospace;
    font-weight: 700;
  }

  .price-impact-warning.severe {
    background: var(--status-error-soft-bg);
    border-color: var(--status-error-soft-border);
    color: var(--status-error-text);
  }

  .price-impact-warning.severe svg {
    color: var(--status-error-text);
  }

  .dex-badge {
    background: linear-gradient(
      135deg,
      var(--accent-gradient-start),
      var(--accent-gradient-end)
    );
    color: var(--text-on-accent);
    min-height: var(--route-badge-height);
    display: inline-flex;
    align-items: center;
    padding: 0 0.65rem;
    border-radius: 0.55rem;
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1;
  }

  .skeleton-text {
    color: transparent !important;
    background: linear-gradient(
      90deg,
      var(--bg-secondary) 25%,
      var(--border-color) 50%,
      var(--bg-secondary) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
    border-radius: 0.25rem;
    user-select: none;
    pointer-events: none;
  }

  .skeleton-badge {
    font-size: 0.75rem;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: var(--route-badge-height);
    padding: 0 0.65rem;
    border-radius: 0.55rem;
    box-sizing: border-box;
    color: transparent;
    background: linear-gradient(
      90deg,
      var(--bg-secondary) 25%,
      var(--border-color) 50%,
      var(--bg-secondary) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.5s ease-in-out infinite;
    user-select: none;
    pointer-events: none;
  }

  @keyframes shimmer {
    0% {
      background-position: 200% 0;
    }
    100% {
      background-position: -200% 0;
    }
  }

  .modal-icon {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .success-icon {
    background: var(--status-success-soft-bg);
    color: var(--status-success-text);
  }

  .modal-title {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .transfers-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
    padding: 0.75rem;
    background: var(--bg-input);
    border-radius: 0.75rem;
  }

  .transfer-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    font-family: "JetBrains Mono", monospace;
  }

  .transfer-in {
    background: var(--status-success-soft-bg);
  }

  .transfer-out {
    background: var(--status-error-soft-bg);
  }

  .transfer-direction {
    font-size: 1.125rem;
    font-weight: 700;
    width: 1.5rem;
    text-align: center;
  }

  .transfer-in .transfer-direction {
    color: var(--status-success-text);
  }

  .transfer-out .transfer-direction {
    color: var(--status-error-text);
  }

  .transfer-amount {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .transfer-symbol {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-left: auto;
  }

  .modal-btn {
    width: 100%;
    padding: 0.875rem;
    margin-top: 0.5rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
    color: var(--text-primary);
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .modal-btn:hover {
    background: var(--bg-input);
    border-color: var(--accent-primary);
  }

  .modal-btn:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .modal-btn:disabled:hover {
    background: var(--bg-secondary);
    border-color: var(--border-color);
  }

  .success-btn {
    background: linear-gradient(
      135deg,
      var(--status-success-solid),
      var(--status-success-solid-hover)
    );
    border: none;
    color: var(--text-on-success);
  }

  .success-btn:hover {
    background: linear-gradient(
      135deg,
      var(--status-success-solid-hover),
      var(--status-success-text)
    );
    border: none;
  }

  .success-btn:disabled:hover {
    background: linear-gradient(
      135deg,
      var(--status-success-solid),
      var(--status-success-solid-hover)
    );
    border: none;
  }

  .keep-btn {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
  }

  @media (--short-screen) {
    .subtitle {
      display: none;
    }
  }

  @media (--tablet) {
    .subtitle {
      display: none;
    }
  }

  /* ── Mobile compact layout ── */
  @media (--mobile) {
    .swap-card {
      padding: 1rem;
      gap: 0.5rem;
      border-radius: 1rem;
    }

    .swap-fields {
      gap: 0.375rem;
    }

    .input-wrapper {
      padding: 0.625rem 0.75rem;
      gap: 0.375rem;
      border-radius: 0.75rem;
    }

    .amount-row {
      gap: 0.5rem;
    }

    input {
      font-size: 1.25rem;
    }

    .usd-value {
      font-size: 0.75rem;
    }

    label {
      font-size: 0.8125rem;
    }

    .balance-display {
      font-size: 0.75rem;
    }

    .token-select {
      gap: 0.375rem;
      padding: 0.375rem 0.625rem;
      font-size: 0.8125rem;
      border-radius: 0.5rem;
    }

    .switch-btn {
      width: 2.125rem;
      height: 2.125rem;
    }

    .switch-btn svg {
      width: 16px;
      height: 16px;
    }

    .route-info {
      --route-badge-height: 1.5rem;
      padding: 0.625rem 0.75rem;
      gap: 0.375rem;
    }

    .route-label,
    .route-value {
      font-size: 0.75rem;
    }

    .route-badge-stack {
      max-width: 68%;
      height: var(--route-badge-height);
    }

    .route-segment {
      font-size: 0.6875rem;
      padding: 0 0.52rem;
    }

    .route-badge-stack > .route-segment:not(:first-child) {
      padding-left: 0.68rem;
    }

    .route-badge-stack > .route-segment:not(:first-child)::before {
      left: -0.32rem;
      width: 0.64rem;
    }

    .route-badge-stack > .route-segment:first-child {
      padding-left: 0.6rem;
      padding-right: 0.78rem;
    }

    .route-segment-clear {
      width: var(--route-badge-height);
    }

    .route-provider-btn svg {
      width: 10px;
      height: 10px;
    }

    .route-picker-item {
      min-height: 3.85rem;
      padding: 0.62rem 0.72rem;
    }

    .route-picker-amount {
      font-size: 0.78rem;
    }

    .route-picker-status-badge {
      min-height: 1.1rem;
      font-size: 0.625rem;
      padding: 0.08rem 0.34rem;
    }

    .price-impact-warning {
      padding: 0.5rem 0.75rem;
      font-size: 0.75rem;
    }

    .swap-btn {
      padding: 0.875rem;
      font-size: 1rem;
      margin-top: 0.25rem;
    }
  }

  /* ── Very short screens: ultra-compact layout ── */
  @media (--short-screen) {
    .swap-card {
      padding: 0.75rem;
      gap: 0.375rem;
    }

    .input-wrapper {
      padding: 0.5rem 0.625rem;
      gap: 0.25rem;
    }

    .swap-fields {
      gap: 0.25rem;
    }

    input {
      font-size: 1.125rem;
    }

    .route-info {
      --route-badge-height: 1.45rem;
      padding: 0.5rem 0.625rem;
      gap: 0.25rem;
    }

    .swap-btn {
      padding: 0.75rem;
      margin-top: 0.125rem;
    }

    .switch-btn {
      width: 2rem;
      height: 2rem;
    }
  }

  /* ── Landscape mobile: maximize usable space ── */
  @media (--landscape-mobile) {
    .swap-card {
      padding: 0.625rem 0.75rem;
      gap: 0.25rem;
    }

    .input-wrapper {
      padding: 0.375rem 0.5rem;
      gap: 0.125rem;
    }

    .swap-fields {
      gap: 0.125rem;
    }

    input {
      font-size: 1rem;
    }

    .swap-btn {
      padding: 0.625rem;
      font-size: 0.875rem;
    }

    .route-info {
      --route-badge-height: 1.4rem;
      padding: 0.375rem 0.5rem;
    }
  }
</style>
