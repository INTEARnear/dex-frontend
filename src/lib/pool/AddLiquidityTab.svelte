<script lang="ts">
  import SwapSettings from "../SwapSettings.svelte";
  import type { AmountPreset, SlippageMode } from "../SwapSettings.svelte";
  import DexPresetButtons, {
    type DexPresetButtonItem,
  } from "../DexPresetButtons.svelte";
  import Spinner from "../Spinner.svelte";
  import TradeSettingsRow from "../TradeSettingsRow.svelte";
  import type { NormalizedPool, Token } from "../types";
  import {
    formatAmount,
    formatBalance,
    formatUsdValue,
    humanReadableToRawAmount,
    rawAmountToHumanReadable,
  } from "../utils";
  import {
    XykAddLiquidityArgsSchema,
    XykRegisterLiquidityArgsSchema,
    serializeToBase64,
  } from "../xykSchemas";
  import { tokenHubStore } from "../tokenHubStore";
  import { walletStore } from "../walletStore";
  import {
    AUTO_LIQUIDITY_SLIPPAGE_PERCENT,
    assetIdToTokenId,
    assertOutcomesSucceeded,
    checkAreAssetsRegistered,
    DEX_CONTRACT_ID,
    DEX_ID,
    GAS_RESERVE_NEAR,
    isSupportedAsset,
  } from "./shared";
  import { STORAGE_DEPOSIT_NEAR } from "./shared";
  import ErrorModal from "../ErrorModal.svelte";
  import {
    parseLiquidityAddedFromOutcomes,
    type LiquidityAddedEventData,
  } from "./liquidityEvents";
  import {
    loadAmountPresetsConfig,
    loadSwapSettingsConfig,
    saveAmountPresetsConfig,
    saveSwapSettingsConfig,
  } from "../swapConfig";
  import type { ConnectorAction } from "@hot-labs/near-connect";

  function loadRiskAwarenessConfig(): boolean {
    try {
      return localStorage.getItem("intear-dex-risk-aware") === "true";
    } catch {}
    return false;
  }

  function formatShares(raw: bigint): string {
    const human = rawAmountToHumanReadable(raw.toString(), 18);
    const num = parseFloat(human);
    return Number.isFinite(num) ? formatAmount(num) : "0";
  }

  function sanitizeAmountInput(value: string): string {
    let text = value.replace(/[^\d.]/g, "");
    const dotIndex = text.indexOf(".");
    if (dotIndex !== -1) {
      text =
        text.slice(0, dotIndex + 1) +
        text.slice(dotIndex + 1).replace(/\./g, "");
    }
    return text;
  }

  function formatByDecimals(value: number, decimals: number): string {
    if (!Number.isFinite(value) || value <= 0) return "";
    const precision = Math.min(Math.max(decimals, 0), 12);
    const fixed = value.toFixed(precision);
    return fixed.replace(/\.?0+$/, "");
  }

  interface Props {
    poolData: NormalizedPool | null;
    token0: Token | null;
    token1: Token | null;
    poolId: number;
    needsRegisterLiquidity: boolean;
    onSuccess: () => Promise<void>;
    onAddSuccess: (payload: {
      eventData: LiquidityAddedEventData;
      attached0: bigint;
      attached1: bigint;
    }) => void;
    isConnecting: boolean;
    onConnectWallet: () => void;
  }

  let {
    poolData,
    token0,
    token1,
    poolId,
    needsRegisterLiquidity,
    onSuccess,
    onAddSuccess,
    isConnecting,
    onConnectWallet,
  }: Props = $props();

  const initialSwap = loadSwapSettingsConfig();
  const initialPresets = loadAmountPresetsConfig();

  let amount0HumanReadable = $state("");
  let amount1HumanReadable = $state("");
  let isRatioInverted = $state(false);
  let swapSettingsOpen = $state(false);
  let swapSlippageMode = $state<SlippageMode>(initialSwap.mode);
  let swapSlippageValue = $state(initialSwap.value);
  let presetsVisible = $state(initialPresets.visible);
  let amountPresets = $state<AmountPreset[]>(initialPresets.presets);
  let isRiskAware = $state(loadRiskAwarenessConfig());
  let risksExpanded = $state(false);
  let isSubmitting = $state(false);
  let txError = $state<string | null>(null);
  let showErrorModal = $state(false);
  let lastAttachedAmount0 = $state<bigint>(0n);
  let lastAttachedAmount1 = $state<bigint>(0n);

  const asset0 = $derived(poolData?.assets[0] ?? null);
  const asset1 = $derived(poolData?.assets[1] ?? null);
  const token0Id = $derived(asset0 ? assetIdToTokenId(asset0.asset_id) : null);
  const token1Id = $derived(asset1 ? assetIdToTokenId(asset1.asset_id) : null);
  const isPrivate = $derived(poolData?.ownerId !== null);
  const isOwner = $derived(
    !!poolData?.ownerId && poolData.ownerId === $walletStore.accountId,
  );
  const revenueSharingBreakdown = $derived.by(() => {
    if (!poolData) return [] as [string, number][];
    const amountsByAccount = new Map<string, number>();
    const connectedAccountId = $walletStore.accountId?.toLowerCase();
    for (const [receiver, amount] of poolData.fees.receivers) {
      if (receiver === "Pool") {
        continue;
      }
      const receiverAccountId = receiver.Account.toLowerCase();
      if (
        receiverAccountId === "plach.intear.near" ||
        (connectedAccountId !== undefined &&
          receiverAccountId === connectedAccountId)
      ) {
        continue;
      }
      amountsByAccount.set(
        receiver.Account,
        (amountsByAccount.get(receiver.Account) ?? 0) + amount,
      );
    }
    return Array.from(amountsByAccount.entries());
  });
  const revenueSharingAccounts = $derived(
    revenueSharingBreakdown.map(([accountId]) => accountId),
  );
  const revenueSharingPercent = $derived.by(() => {
    const accountFees = revenueSharingBreakdown.reduce(
      (acc, [, amount]) => acc + amount,
      0,
    );
    const userReceivesFee = (poolData?.fees.receivers ?? []).reduce(
      (acc, [receiver, amount]) =>
        receiver === "Pool" || receiver.Account === $walletStore.accountId
          ? acc + amount
          : acc,
      0,
    );
    const totalRevenueFee = accountFees + userReceivesFee;
    if (totalRevenueFee <= 0) return 0;
    return (accountFees / totalRevenueFee) * 100;
  });
  const revenueSharingPercentText = $derived.by(() => {
    const formatted = formatByDecimals(revenueSharingPercent, 4);
    return formatted || "0";
  });

  function getUserBalanceRaw(tokenId: string | null): string {
    if (!tokenId) return "0";
    return $tokenHubStore.tokensById[tokenId]?.balance ?? "0";
  }

  const poolRatio = $derived.by(() => {
    if (!poolData || !token0 || !token1) return null;
    const amount0 =
      parseFloat(poolData.assets[0].balance) /
      Math.pow(10, token0.metadata.decimals);
    const amount1 =
      parseFloat(poolData.assets[1].balance) /
      Math.pow(10, token1.metadata.decimals);
    if (!Number.isFinite(amount0) || amount0 <= 0) return null;
    if (!Number.isFinite(amount1) || amount1 <= 0) return null;
    return amount1 / amount0;
  });

  const displayedPoolRatio = $derived.by(() => {
    if (!poolRatio) return null;
    if (!isRatioInverted) return poolRatio;
    return poolRatio > 0 ? 1 / poolRatio : null;
  });

  const ratioBaseSymbol = $derived(
    isRatioInverted
      ? (token1?.metadata.symbol ?? "?")
      : (token0?.metadata.symbol ?? "?"),
  );
  const ratioQuoteSymbol = $derived(
    isRatioInverted
      ? (token0?.metadata.symbol ?? "?")
      : (token1?.metadata.symbol ?? "?"),
  );

  const effectiveSlippagePercent = $derived(
    swapSlippageMode === "auto"
      ? AUTO_LIQUIDITY_SLIPPAGE_PERCENT
      : swapSlippageValue,
  );

  const amount0Raw = $derived.by(() => {
    if (!token0) return 0n;
    return BigInt(
      humanReadableToRawAmount(amount0HumanReadable, token0.metadata.decimals),
    );
  });

  const amount1Raw = $derived.by(() => {
    if (!token1) return 0n;
    return BigInt(
      humanReadableToRawAmount(amount1HumanReadable, token1.metadata.decimals),
    );
  });

  const hasValidAmounts = $derived(amount0Raw > 0n && amount1Raw > 0n);

  function calculateEstimatedShares(
    totalSharesRaw: bigint,
    poolBalance0Raw: bigint,
    poolBalance1Raw: bigint,
    amount0Raw: bigint,
    amount1Raw: bigint,
  ): bigint | null {
    if (
      totalSharesRaw <= 0n ||
      poolBalance0Raw <= 0n ||
      poolBalance1Raw <= 0n ||
      amount0Raw <= 1n ||
      amount1Raw <= 1n
    ) {
      return null;
    }
    const sharesFrom0 = ((amount0Raw - 1n) * totalSharesRaw) / poolBalance0Raw;
    const sharesFrom1 = ((amount1Raw - 1n) * totalSharesRaw) / poolBalance1Raw;
    const mintable = sharesFrom0 < sharesFrom1 ? sharesFrom0 : sharesFrom1;
    return mintable > 0n ? mintable : null;
  }

  const estimatedSharesRaw = $derived.by(() => {
    if (!poolData || poolData.ownerId !== null || !hasValidAmounts) return null;
    if (!poolData.totalSharesRaw) return null;
    const totalShares = BigInt(poolData.totalSharesRaw);
    const poolBalance0 = BigInt(poolData.assets[0].balance);
    const poolBalance1 = BigInt(poolData.assets[1].balance);
    return calculateEstimatedShares(
      totalShares,
      poolBalance0,
      poolBalance1,
      amount0Raw,
      amount1Raw,
    );
  });

  const minSharesRawForTx = $derived.by(() => {
    if (!estimatedSharesRaw) return null;
    const slippageBps = BigInt(
      Math.min(10000, Math.max(0, Math.round(effectiveSlippagePercent * 100))),
    );
    const minRaw = (estimatedSharesRaw * (10000n - slippageBps)) / 10000n;
    return minRaw > 0n ? minRaw : null;
  });

  const isPoolEmpty = $derived(!!poolData && !poolData.totalSharesRaw);

  const swapSettingsDisplay = $derived(
    swapSlippageMode === "auto" ? "Auto" : `${swapSlippageValue}%`,
  );

  function getToken0EffectiveBalanceRaw(): bigint | null {
    if (!token0 || !token0Id) return null;
    let balanceRaw = BigInt(getUserBalanceRaw(token0Id));
    if (token0Id === "near") {
      balanceRaw =
        balanceRaw > GAS_RESERVE_NEAR ? balanceRaw - GAS_RESERVE_NEAR : 0n;
    }
    return balanceRaw;
  }

  function getPriceRatioFallback(): number | null {
    if (!token0 || !token1) return null;
    const price0 = parseFloat(token0.price_usd);
    const price1 = parseFloat(token1.price_usd);
    if (!Number.isFinite(price0) || !Number.isFinite(price1)) return null;
    if (price0 <= 0 || price1 <= 0) return null;
    return price0 / price1;
  }

  function computePresetAmount(preset: AmountPreset): string | null {
    if (!token0) return null;
    if (preset.type === "percent") {
      const balanceRaw = getToken0EffectiveBalanceRaw();
      if (balanceRaw === null) return null;
      const scaled = (balanceRaw * BigInt(preset.value)) / 100n;
      if (scaled <= 0n) return null;
      return rawAmountToHumanReadable(
        scaled.toString(),
        token0.metadata.decimals,
      );
    }
    const tokenPrice = parseFloat(token0.price_usd);
    if (!Number.isFinite(tokenPrice) || tokenPrice <= 0) return null;
    const tokenAmount = preset.value / tokenPrice;
    const raw = BigInt(
      humanReadableToRawAmount(
        tokenAmount.toFixed(token0.metadata.decimals),
        token0.metadata.decimals,
      ),
    );
    const halfRaw = raw / 2n;
    if (halfRaw <= 0n) return null;
    return rawAmountToHumanReadable(
      halfRaw.toString(),
      token0.metadata.decimals,
    );
  }

  const activePresetIndex = $derived.by(() => {
    if (!token0 || !amount0HumanReadable) return null;
    for (let i = 0; i < amountPresets.length; i++) {
      const expected = computePresetAmount(amountPresets[i]);
      if (expected !== null && expected === amount0HumanReadable) return i;
    }
    return null;
  });

  const requiredNearRaw = $derived.by(() => {
    let total = isPrivate ? 0n : STORAGE_DEPOSIT_NEAR;
    if (asset0?.asset_id === "near") total += amount0Raw;
    if (asset1?.asset_id === "near") total += amount1Raw;
    return total;
  });

  const insufficientReason = $derived.by(() => {
    if (!hasValidAmounts || !token0 || !token1) return null;
    if (!token0Id || !token1Id) return "Unsupported pool assets";
    const balance0 = BigInt(getUserBalanceRaw(token0Id));
    const balance1 = BigInt(getUserBalanceRaw(token1Id));
    if (token0Id !== "near" && amount0Raw > balance0) {
      return `Insufficient ${token0.metadata.symbol} balance`;
    }
    if (token1Id !== "near" && amount1Raw > balance1) {
      return `Insufficient ${token1.metadata.symbol} balance`;
    }
    const nearBalance = BigInt(getUserBalanceRaw("near"));
    const nearAvailable =
      nearBalance > GAS_RESERVE_NEAR ? nearBalance - GAS_RESERVE_NEAR : 0n;
    if (requiredNearRaw > nearAvailable) return "Insufficient NEAR balance";
    return null;
  });

  const canSubmit = $derived.by(() => {
    if (
      !$walletStore.isConnected ||
      !$walletStore.wallet ||
      !$walletStore.accountId
    )
      return false;
    if (!poolData || !token0 || !token1) return false;
    if (!isSupportedAsset(poolData.assets[0].asset_id)) return false;
    if (!isSupportedAsset(poolData.assets[1].asset_id)) return false;
    if (!hasValidAmounts) return false;
    if (isSubmitting) return false;
    if (insufficientReason) return false;
    if (!isRiskAware) return false;
    if (
      poolData.ownerId !== null &&
      poolData.ownerId !== $walletStore.accountId
    )
      return false;
    return true;
  });

  const amount0Usd = $derived(
    token0 ? formatUsdValue(amount0HumanReadable, token0.price_usd) : null,
  );
  const amount1Usd = $derived(
    token1 ? formatUsdValue(amount1HumanReadable, token1.price_usd) : null,
  );

  const token0BalanceDisplay = $derived.by(() => {
    if (!token0 || !token0Id) return "0";
    return formatBalance(getUserBalanceRaw(token0Id), token0.metadata.decimals);
  });

  const token1BalanceDisplay = $derived.by(() => {
    if (!token1 || !token1Id) return "0";
    return formatBalance(getUserBalanceRaw(token1Id), token1.metadata.decimals);
  });

  function setAmount0AndRecalculate(nextAmount0: string) {
    amount0HumanReadable = sanitizeAmountInput(nextAmount0);
    if (!poolRatio || !token1) return;
    const amountNum = parseFloat(amount0HumanReadable);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      amount1HumanReadable = "";
      return;
    }
    amount1HumanReadable = formatByDecimals(
      amountNum * poolRatio,
      token1.metadata.decimals,
    );
  }

  function onAmount0Input(value: string) {
    setAmount0AndRecalculate(value);
  }

  function onAmount1Input(value: string) {
    amount1HumanReadable = sanitizeAmountInput(value);
    if (!poolRatio || !token0) return;
    const amountNum = parseFloat(amount1HumanReadable);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      amount0HumanReadable = "";
      return;
    }
    amount0HumanReadable = formatByDecimals(
      amountNum / poolRatio,
      token0.metadata.decimals,
    );
  }

  function applyPreset(preset: AmountPreset) {
    const amount = computePresetAmount(preset);
    if (amount === null) return;
    const fallbackRatio = getPriceRatioFallback();
    if (!poolRatio && fallbackRatio && token1) {
      amount0HumanReadable = sanitizeAmountInput(amount);
      const amountNum = parseFloat(amount0HumanReadable);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        amount1HumanReadable = "";
        return;
      }
      amount1HumanReadable = formatByDecimals(
        amountNum * fallbackRatio,
        token1.metadata.decimals,
      );
      return;
    }
    setAmount0AndRecalculate(amount);
  }

  function handleSlippageChange(mode: SlippageMode, value: number) {
    swapSlippageMode = mode;
    swapSlippageValue = value;
    saveSwapSettingsConfig(mode, value);
  }

  function handlePresetsChange(visible: boolean, presets: AmountPreset[]) {
    presetsVisible = visible;
    amountPresets = presets;
    saveAmountPresetsConfig(visible, presets);
  }

  function handleRiskAwarenessChange(checked: boolean) {
    isRiskAware = checked;
    try {
      localStorage.setItem("intear-dex-risk-aware", checked ? "true" : "false");
    } catch {}
  }

  async function handleAddLiquidity() {
    if (
      !$walletStore.isConnected ||
      !$walletStore.wallet ||
      !$walletStore.accountId ||
      !poolData ||
      !token0 ||
      !token1 ||
      !canSubmit
    )
      return;
    if (!isPoolEmpty && !minSharesRawForTx) return;

    txError = null;
    isSubmitting = true;

    try {
      const accountId = $walletStore.accountId;
      const wallet = $walletStore.wallet;

      const nearFromLiquidity =
        (poolData.assets[0].asset_id === "near" ? amount0Raw : 0n) +
        (poolData.assets[1].asset_id === "near" ? amount1Raw : 0n);

      const assetsToEnsure = new Set<string>([
        poolData.assets[0].asset_id,
        poolData.assets[1].asset_id,
      ]);
      if (nearFromLiquidity > 0n) assetsToEnsure.add("near");

      const areRegisteredForUser = await checkAreAssetsRegistered(
        { Account: accountId },
        [...assetsToEnsure],
      );
      const areRegisteredForXyk = await checkAreAssetsRegistered(
        { Dex: DEX_ID },
        [...assetsToEnsure],
      );

      const transactions: Array<{
        receiverId: string;
        actions: Array<ConnectorAction>;
      }> = [];

      if (!areRegisteredForUser || !areRegisteredForXyk) {
        const registrationActions = [];
        if (!areRegisteredForUser) {
          registrationActions.push({
            type: "FunctionCall" as const,
            params: {
              methodName: "register_assets",
              args: { asset_ids: [...assetsToEnsure] },
              gas: "10" + "0".repeat(12), // 10 TGas
              deposit: "1",
            },
          });
        }
        if (!areRegisteredForXyk) {
          registrationActions.push({
            type: "FunctionCall" as const,
            params: {
              methodName: "register_assets",
              args: { asset_ids: [...assetsToEnsure], for: { Dex: DEX_ID } },
              gas: "10" + "0".repeat(12), // 10 TGas
              deposit: "1",
            },
          });
        }
        transactions.push({
          receiverId: DEX_CONTRACT_ID,
          actions: [
            {
              type: "FunctionCall" as const,
              params: {
                methodName: "storage_deposit",
                args: {},
                gas: "10" + "0".repeat(12), // 10 TGas
                deposit: STORAGE_DEPOSIT_NEAR.toString(),
              },
            },
            ...registrationActions,
          ],
        });
      }

      for (let i = 0; i < poolData.assets.length; i++) {
        const asset = poolData.assets[i];
        if (asset.asset_id === "near") continue;
        if (!asset.asset_id.startsWith("nep141:")) {
          throw new Error(`Unsupported asset type: ${asset.asset_id}`);
        }
        const amountRaw = i === 0 ? amount0Raw : amount1Raw;
        if (amountRaw <= 0n) continue;

        const tokenContractId = asset.asset_id.slice("nep141:".length);
        transactions.push({
          receiverId: tokenContractId,
          actions: [
            {
              type: "FunctionCall",
              params: {
                methodName: "storage_deposit",
                args: { account_id: DEX_CONTRACT_ID, registration_only: true },
                gas: "10" + "0".repeat(12), // 10 TGas
                deposit: "125" + "0".repeat(24 - 5),
              },
            },
            {
              type: "FunctionCall",
              params: {
                methodName: "ft_transfer_call",
                args: {
                  receiver_id: DEX_CONTRACT_ID,
                  amount: amountRaw.toString(),
                  msg: "",
                },
                gas: "40" + "0".repeat(12), // 40 TGas
                deposit: "1",
              },
            },
          ],
        });
      }

      const operations: Array<{
        DexCall: {
          dex_id: string;
          method: string;
          args: string;
          attached_assets: Record<string, string>;
        };
      }> = [];

      if (needsRegisterLiquidity) {
        operations.push({
          DexCall: {
            dex_id: DEX_ID,
            method: "register_liquidity",
            args: serializeToBase64(XykRegisterLiquidityArgsSchema, {
              pool_id: poolId,
            }),
            attached_assets: { near: STORAGE_DEPOSIT_NEAR.toString() },
          },
        });
      }

      operations.push({
        DexCall: {
          dex_id: DEX_ID,
          method: "add_liquidity",
          args: serializeToBase64(XykAddLiquidityArgsSchema, {
            pool_id: poolId,
            min_shares_received: isPoolEmpty ? null : minSharesRawForTx,
          }),
          attached_assets: {
            [poolData.assets[0].asset_id]: amount0Raw.toString(),
            [poolData.assets[1].asset_id]: amount1Raw.toString(),
          },
        },
      });

      const executeDeposit = (
        nearFromLiquidity +
        (needsRegisterLiquidity ? STORAGE_DEPOSIT_NEAR : 0n) +
        1n
      ).toString();
      transactions.push({
        receiverId: DEX_CONTRACT_ID,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName: "execute_operations",
              args: { operations },
              gas: "120" + "0".repeat(12), // 120 TGas
              deposit: executeDeposit,
            },
          },
        ],
      });

      lastAttachedAmount0 = amount0Raw;
      lastAttachedAmount1 = amount1Raw;

      const outcomes = await wallet.signAndSendTransactions({ transactions });
      assertOutcomesSucceeded(outcomes);

      const addedEvent = parseLiquidityAddedFromOutcomes(outcomes);
      if (addedEvent) {
        onAddSuccess({
          eventData: addedEvent,
          attached0: lastAttachedAmount0,
          attached1: lastAttachedAmount1,
        });
      }
      amount0HumanReadable = "";
      amount1HumanReadable = "";
      await onSuccess();
    } catch (submitError) {
      console.error("Add liquidity failed:", submitError);
      txError =
        submitError instanceof Error
          ? submitError.message
          : "Failed to add liquidity";
      showErrorModal = true;
    } finally {
      isSubmitting = false;
    }
  }
</script>

<TradeSettingsRow
  bind:open={swapSettingsOpen}
  settingsLabel={swapSettingsDisplay}
  dialogLabel="Liquidity settings"
  closeBackdropLabel="Close liquidity settings"
>
  {#snippet presets()}
    {#if presetsVisible && $walletStore.isConnected && token0 && token0Id}
      {@const token0Price = parseFloat(token0.price_usd)}
      <DexPresetButtons
        items={amountPresets.reduce((buttons, preset, i) => {
          if (preset.type === "percent" || token0Price > 0) {
            buttons.push({
              id: i,
              label:
                preset.type === "dollar"
                  ? `$${preset.value}`
                  : `${preset.value}%`,
              active: activePresetIndex === i,
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

{#if !poolData || !isSupportedAsset(poolData.assets[0].asset_id) || !isSupportedAsset(poolData.assets[1].asset_id)}
  <div class="warning-box error-box">
    This pool contains unsupported assets for this form.
  </div>
{:else}
  {#if poolRatio}
    <div class="warning-box ratio-box">
      <span class="ratio-text">
        1 {ratioBaseSymbol} = {formatAmount(displayedPoolRatio ?? 0)}{" "}
        {ratioQuoteSymbol}
      </span>
      <button
        type="button"
        class="ratio-switch-btn"
        onclick={() => (isRatioInverted = !isRatioInverted)}
        aria-label="Switch token ratio direction"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M17 3l4 4-4 4" />
          <path d="M3 7h18" />
          <path d="M7 21l-4-4 4-4" />
          <path d="M21 17H3" />
        </svg>
      </button>
    </div>
  {:else}
    <div class="warning-box ratio-box ratio-warning">
      Pool is empty, enter both amounts carefully to make sure the dollar amount
      of both tokens matches.
    </div>
  {/if}

  <div class="input-wrapper">
    <div class="input-header">
      <label for="asset0-amount">{token0?.metadata.symbol ?? "?"}</label>
      <span class="balance-label">Balance: {token0BalanceDisplay}</span>
    </div>
    <div class="amount-row">
      <input
        id="asset0-amount"
        type="text"
        placeholder="0.00"
        value={amount0HumanReadable}
        oninput={(e) => onAmount0Input(e.currentTarget.value)}
        disabled={!$walletStore.isConnected}
        aria-describedby={isPrivate && $walletStore.isConnected && !isOwner
          ? "add-liquidity-owner-warning"
          : insufficientReason
            ? "add-liquidity-balance-error"
            : undefined}
      />
    </div>
    <div class="usd-label">{amount0Usd ?? "\u00a0"}</div>
  </div>

  <div class="plus-separator">+</div>

  <div class="input-wrapper">
    <div class="input-header">
      <label for="asset1-amount">{token1?.metadata.symbol ?? "?"}</label>
      <span class="balance-label">Balance: {token1BalanceDisplay}</span>
    </div>
    <div class="amount-row">
      <input
        id="asset1-amount"
        type="text"
        placeholder="0.00"
        value={amount1HumanReadable}
        oninput={(e) => onAmount1Input(e.currentTarget.value)}
        disabled={!$walletStore.isConnected}
        aria-describedby={isPrivate && $walletStore.isConnected && !isOwner
          ? "add-liquidity-owner-warning"
          : insufficientReason
            ? "add-liquidity-balance-error"
            : undefined}
      />
    </div>
    <div class="usd-label">{amount1Usd ?? "\u00a0"}</div>
  </div>

  {#if estimatedSharesRaw}
    <div class="estimation-box">
      <div class="estimation-row">
        <span class="estimation-label">Estimated shares</span>
        <span class="estimation-value">{formatShares(estimatedSharesRaw)}</span>
      </div>
      <div class="estimation-row">
        <span class="estimation-label">Min shares received</span>
        <span class="estimation-value">
          {#if minSharesRawForTx}
            {formatShares(minSharesRawForTx)}
          {:else}
            Not set
          {/if}
        </span>
      </div>
    </div>
  {/if}

  {#if isPrivate && $walletStore.isConnected && !isOwner}
    <div
      id="add-liquidity-owner-warning"
      class="warning-box error-box"
      role="alert"
      aria-live="assertive"
    >
      Only pool owner can add liquidity to this private pool.
    </div>
  {:else if insufficientReason}
    <div
      id="add-liquidity-balance-error"
      class="warning-box error-box"
      role="alert"
      aria-live="assertive"
    >
      {insufficientReason}
    </div>
  {/if}

  {#if txError && !showErrorModal}
    <div class="warning-box error-box" role="alert" aria-live="assertive">
      {txError}
    </div>
  {/if}

  <ErrorModal
    isOpen={showErrorModal}
    onClose={() => {
      showErrorModal = false;
      txError = null;
    }}
    title="Add Liquidity Failed"
    message={txError ?? ""}
    isTransaction={true}
  />

  <div class="risk-awareness">
    <label class="risk-awareness-label">
      <input
        type="checkbox"
        checked={isRiskAware}
        onchange={(e) => handleRiskAwarenessChange(e.currentTarget.checked)}
      />
      <span>
        I'm aware of and accept the{" "}
        <button
          type="button"
          class="risk-link"
          onclick={() => (risksExpanded = !risksExpanded)}
          aria-expanded={risksExpanded}
        >
          risks
        </button>
        {" "}of supplying liquidity.
      </span>
    </label>

    {#if risksExpanded}
      <ul class="risk-list">
        <li>
          <strong>Impermanent loss:</strong> token prices can diverge after deposit,
          so withdrawing later can be worth less than just holding both tokens or
          one token. Best-case scenario for liquidity providers is that there's a
          lot of volume but token prices don't change much.
        </li>
        <li>
          <strong>Volatility:</strong> cryptocurrency is not the most stable investment
          on the planet, you can often see tokens go up and down by over 50% in less
          than a day.
        </li>
        <li>
          <strong>Smart contract risk:</strong> contract bugs or exploits can cause
          partial or total loss of deposited assets. Depending on amount, Intear might
          not be able to cover the loss.
        </li>
      </ul>
    {/if}
  </div>

  {#if poolData?.locked}
    <div class="warning-box pool-warning">
      This pool is locked. This means you will not be able to withdraw the
      liquidity you add. If you want to add withdrawable liquidity, create a new
      pool that is not locked.
    </div>
  {/if}

  {#if revenueSharingAccounts.length > 0 && revenueSharingPercent > 0}
    <div class="warning-box pool-warning">
      {revenueSharingAccounts.join(", ")}
      {" "}
      {revenueSharingAccounts.length === 1 ? "receives" : "receive"}
      {" "}
      {revenueSharingPercentText}% of the revenue from this pool. If you don't
      intend to share fees with them, choose a different pool or create a new
      one.
    </div>
  {/if}

  {#if !$walletStore.isConnected}
    <button
      class="primary-btn"
      onclick={onConnectWallet}
      disabled={isConnecting}
    >
      {isConnecting ? "Connecting..." : "Connect Wallet"}
    </button>
  {:else}
    <button
      class="primary-btn"
      onclick={handleAddLiquidity}
      disabled={!canSubmit}
    >
      {#if isSubmitting}
        <Spinner tone="light" />
        Adding Liquidity...
      {:else if isPrivate && !isOwner}
        Owner Only
      {:else}
        Add Liquidity
      {/if}
    </button>
  {/if}
{/if}

<style>
  .warning-box {
    border-radius: 0.75rem;
    padding: 0.75rem 1rem;
    font-size: 0.8125rem;
  }
  .pool-warning {
    background: rgba(234, 179, 8, 0.12);
    border: 1px solid rgba(234, 179, 8, 0.35);
    color: #facc15;
    line-height: 1.4;
  }
  .ratio-box {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
  }
  .ratio-text {
    min-width: 0;
    word-break: break-word;
  }
  .ratio-switch-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.5rem;
    border: 1px solid var(--border-color);
    background: var(--bg-card);
    color: var(--text-secondary);
    cursor: pointer;
    flex-shrink: 0;
    transition:
      color 0.15s ease,
      border-color 0.15s ease,
      background 0.15s ease;
  }
  .ratio-switch-btn:hover {
    color: var(--text-primary);
    border-color: var(--accent-primary);
    background: var(--bg-secondary);
  }
  .ratio-switch-btn svg {
    width: 0.95rem;
    height: 0.95rem;
  }
  .ratio-warning {
    background: rgba(234, 179, 8, 0.12);
    border-color: rgba(234, 179, 8, 0.35);
    color: #facc15;
  }
  .error-box {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.25);
    color: #f87171;
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
  .balance-label {
    font-size: 0.8125rem;
    color: var(--text-muted);
    font-family: "JetBrains Mono", monospace;
  }
  .amount-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }
  .amount-row input {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font-size: 1.5rem;
    font-weight: 600;
    min-width: 0;
  }
  .amount-row input::placeholder {
    color: var(--text-muted);
  }
  .amount-row input:disabled {
    cursor: not-allowed;
  }
  .usd-label {
    color: var(--text-muted);
    font-size: 0.8125rem;
    min-height: 1.125rem;
    font-family: "JetBrains Mono", monospace;
  }
  .plus-separator {
    width: 100%;
    text-align: center;
    color: var(--text-muted);
    font-size: 1rem;
  }
  .estimation-box {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
    padding: 0.875rem 1rem;
  }
  .estimation-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .estimation-label {
    color: var(--text-secondary);
    font-size: 0.8125rem;
  }
  .estimation-value {
    font-size: 0.8125rem;
    color: var(--text-primary);
    font-weight: 500;
    font-family: "JetBrains Mono", monospace;
  }
  .risk-awareness {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
    padding: 0.875rem 1rem;
  }
  .risk-awareness-label {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.35;
    margin: 0;
  }
  .risk-awareness-label input {
    margin-top: 0.1rem;
  }
  .risk-link {
    border: none;
    background: transparent;
    color: var(--text-secondary);
    text-decoration: underline;
    text-underline-offset: 2px;
    padding: 0;
    font: inherit;
    cursor: pointer;
  }
  .risk-link:hover {
    color: var(--text-primary);
  }
  .risk-list {
    margin: 0;
    padding-left: 1.25rem;
    color: var(--text-secondary);
    font-size: 0.8125rem;
    line-height: 1.45;
  }
  .risk-list li {
    margin-bottom: 0.375rem;
  }
  .risk-list li:last-child {
    margin-bottom: 0;
  }
  .primary-btn {
    width: 100%;
    padding: 1rem 1.25rem;
    font-size: 1.25rem;
    font-weight: bold;
    border: none;
    border-radius: 0.75rem;
    background: var(--accent-button);
    color: white;
    cursor: pointer;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }
  .primary-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }
  .primary-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  @media (--small-mobile) {
    .input-wrapper {
      padding: 0.5rem 0.625rem;
      gap: 0.25rem;
    }
    .amount-row input {
      font-size: 1.125rem;
    }
    .estimation-box {
      padding: 0.5rem 0.625rem;
      gap: 0.25rem;
    }
    .primary-btn {
      padding: 0.75rem;
      margin-top: 0.125rem;
    }
  }
</style>
