<script lang="ts">
  import SwapSettings from "../SwapSettings.svelte";
  import type { AmountPreset, SlippageMode } from "../SwapSettings.svelte";
  import DexPresetButtons, {
    type DexPresetButtonItem,
  } from "../DexPresetButtons.svelte";
  import Spinner from "../Spinner.svelte";
  import TradeSettingsRow from "../TradeSettingsRow.svelte";
  import type { Token } from "../types";
  import {
    formatAmount,
    formatBalance,
    getTokenIcon,
    rawAmountToHumanReadable,
  } from "../utils";
  import {
    XykRemoveLiquidityArgsSchema,
    serializeToBase64,
  } from "../xykSchemas";
  import { walletStore } from "../walletStore";
  import {
    AUTO_LIQUIDITY_SLIPPAGE_PERCENT,
    assertOutcomesSucceeded,
    DEX_CONTRACT_ID,
    DEX_ID,
  } from "./shared";
  import type { NormalizedPool } from "./shared";
  import ErrorModal from "../ErrorModal.svelte";
  import {
    parseLiquidityRemovedFromOutcomes,
    type LiquidityRemovedEventData,
  } from "./liquidityEvents";
  import {
    loadAmountPresetsConfig,
    loadSwapSettingsConfig,
    saveAmountPresetsConfig,
    saveSwapSettingsConfig,
  } from "../swapConfig";

  function formatShares(raw: bigint): string {
    const human = rawAmountToHumanReadable(raw.toString(), 18);
    const num = parseFloat(human);
    return Number.isFinite(num) ? formatAmount(num) : "0";
  }

  interface Props {
    poolData: NormalizedPool | null;
    token0: Token | null;
    token1: Token | null;
    userSharesRaw: string | null;
    poolId: number | null;
    hasOpenPositions: boolean;
    onSuccess: () => Promise<void>;
    onRemoveSuccess: (payload: {
      eventData: LiquidityRemovedEventData;
    }) => void;
  }

  let {
    poolData,
    token0,
    token1,
    userSharesRaw,
    poolId,
    hasOpenPositions,
    onSuccess,
    onRemoveSuccess,
  }: Props = $props();

  const initialSwap = loadSwapSettingsConfig();
  const initialPresets = loadAmountPresetsConfig();

  let removePercent = $state(50);
  let swapSettingsOpen = $state(false);
  let swapSlippageMode = $state<SlippageMode>(initialSwap.mode);
  let swapSlippageValue = $state(initialSwap.value);
  let presetsVisible = $state(initialPresets.visible);
  let amountPresets = $state<AmountPreset[]>(initialPresets.presets);
  let isSubmitting = $state(false);
  let txError = $state<string | null>(null);
  let showErrorModal = $state(false);

  const effectiveSlippagePercent = $derived(
    swapSlippageMode === "auto"
      ? AUTO_LIQUIDITY_SLIPPAGE_PERCENT
      : swapSlippageValue,
  );

  const userPositionUsd = $derived.by(() => {
    if (
      !poolData ||
      !token0 ||
      !token1 ||
      !userSharesRaw ||
      !poolData.totalSharesRaw
    )
      return 0;
    const userShares = BigInt(userSharesRaw);
    const totalPoolShares = BigInt(poolData.totalSharesRaw);
    if (userShares <= 0n || totalPoolShares <= 0n) return 0;
    const poolBalance0 = BigInt(poolData.assets[0].balance);
    const poolBalance1 = BigInt(poolData.assets[1].balance);
    const userAmount0Raw = (userShares * poolBalance0) / totalPoolShares;
    const userAmount1Raw = (userShares * poolBalance1) / totalPoolShares;
    const userAmount0 = parseFloat(
      rawAmountToHumanReadable(
        userAmount0Raw.toString(),
        token0.metadata.decimals,
      ),
    );
    const userAmount1 = parseFloat(
      rawAmountToHumanReadable(
        userAmount1Raw.toString(),
        token1.metadata.decimals,
      ),
    );
    const price0 = parseFloat(token0.price_usd || "0");
    const price1 = parseFloat(token1.price_usd || "0");
    const usdValue = userAmount0 * price0 + userAmount1 * price1;
    return Number.isFinite(usdValue) && usdValue > 0 ? usdValue : 0;
  });

  const removeQuickPresets = $derived.by(() => {
    return amountPresets.map((preset, index) => {
      if (preset.type === "percent") {
        const value = Math.min(100, Math.max(1, Math.round(preset.value)));
        return {
          key: `percent-${index}-${value}`,
          label: `${value}%`,
          percent: value,
          disabled: false,
          insufficientDollar: false,
        };
      }
      const insufficientDollar =
        userPositionUsd <= 0 || preset.value > userPositionUsd;
      if (insufficientDollar) {
        return {
          key: `dollar-${index}-${preset.value}`,
          label: `$${preset.value}`,
          percent: null,
          disabled: true,
          insufficientDollar: true,
        };
      }
      const percent = Math.min(
        100,
        Math.max(1, Math.round((preset.value / userPositionUsd) * 100)),
      );
      return {
        key: `dollar-${index}-${preset.value}`,
        label: `$${preset.value}`,
        percent,
        disabled: false,
        insufficientDollar: false,
      };
    });
  });

  const removePreview = $derived.by(() => {
    const isPrivate = poolData?.ownerId !== null;
    if (
      !poolData ||
      !token0 ||
      !token1 ||
      !userSharesRaw ||
      (!poolData.totalSharesRaw && !isPrivate)
    )
      return null;
    const userShares = BigInt(userSharesRaw);
    const totalPoolShares = BigInt(poolData.totalSharesRaw ?? "0");
    const poolBalance0 = BigInt(poolData.assets[0].balance);
    const poolBalance1 = BigInt(poolData.assets[1].balance);
    if (totalPoolShares <= 0n && !isPrivate) return null;

    const sharesToRemove = (userShares * BigInt(removePercent)) / 100n;
    if (sharesToRemove <= 0n && !isPrivate) return null;

    const amount0Raw =
      totalPoolShares === 0n
        ? (poolBalance0 * BigInt(removePercent)) / 100n
        : (sharesToRemove * poolBalance0) / totalPoolShares;
    const amount1Raw =
      totalPoolShares === 0n
        ? (poolBalance1 * BigInt(removePercent)) / 100n
        : (sharesToRemove * poolBalance1) / totalPoolShares;

    const amount0Human = rawAmountToHumanReadable(
      amount0Raw.toString(),
      token0.metadata.decimals,
    );
    const amount1Human = rawAmountToHumanReadable(
      amount1Raw.toString(),
      token1.metadata.decimals,
    );

    const price0 = parseFloat(token0.price_usd || "0");
    const price1 = parseFloat(token1.price_usd || "0");
    const usdValue =
      parseFloat(amount0Human) * price0 + parseFloat(amount1Human) * price1;

    return {
      amount0Human,
      amount1Human,
      amount0Raw,
      amount1Raw,
      sharesToRemove,
      usdValue: Number.isFinite(usdValue) ? usdValue : 0,
    };
  });

  const minAssetsReceivedForTx = $derived.by(() => {
    if (!removePreview) return null;
    const slippageBps = BigInt(
      Math.min(10000, Math.max(0, Math.round(effectiveSlippagePercent * 100))),
    );
    const min0 = (removePreview.amount0Raw * (10000n - slippageBps)) / 10000n;
    const min1 = (removePreview.amount1Raw * (10000n - slippageBps)) / 10000n;
    return [min0, min1] as [bigint, bigint];
  });

  const canRemove = $derived.by(() => {
    if (
      !$walletStore.isConnected ||
      !$walletStore.wallet ||
      !$walletStore.accountId
    )
      return false;
    if (!poolData || !token0 || !token1) return false;
    const isPrivate = poolData.ownerId !== null;
    if (!userSharesRaw || (BigInt(userSharesRaw) <= 0n && !isPrivate))
      return false;
    if (removePercent <= 0 || removePercent > 100) return false;
    if (isSubmitting) return false;
    if (!removePreview || (removePreview.sharesToRemove <= 0n && !isPrivate))
      return false;
    return true;
  });

  const swapSettingsDisplay = $derived(
    swapSlippageMode === "auto" ? "Auto" : `${swapSlippageValue}%`,
  );

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

  async function handleRemoveLiquidity() {
    if (
      !$walletStore.isConnected ||
      !$walletStore.wallet ||
      !$walletStore.accountId ||
      !poolData ||
      !token0 ||
      !token1 ||
      !canRemove ||
      !removePreview ||
      !minAssetsReceivedForTx ||
      poolId === null
    )
      return;

    txError = null;
    isSubmitting = true;

    try {
      const wallet = $walletStore.wallet;

      const isPrivate = poolData?.ownerId !== null;
      const operations = [
        {
          DexCall: {
            dex_id: DEX_ID,
            method: "remove_liquidity",
            args: serializeToBase64(XykRemoveLiquidityArgsSchema, {
              pool_id: poolId,
              shares_to_remove:
                removePercent === 100 ? null : removePreview.sharesToRemove,
              min_assets_received: isPrivate ? null : minAssetsReceivedForTx,
            }),
            attached_assets: {} as Record<string, string>,
          },
        },
      ];

      const transactions = [
        {
          receiverId: DEX_CONTRACT_ID,
          actions: [
            {
              type: "FunctionCall",
              params: {
                methodName: "execute_operations",
                args: { operations },
                gas: "120" + "0".repeat(12), // 120 TGas
                deposit: "1",
              },
            },
          ],
        },
      ];

      const outcomes = await wallet.signAndSendTransactions({ transactions });
      assertOutcomesSucceeded(outcomes);

      const removedEvent = parseLiquidityRemovedFromOutcomes(outcomes);
      if (removedEvent) {
        onRemoveSuccess({ eventData: removedEvent });
      }
      removePercent = 50;
      await onSuccess();
    } catch (submitError) {
      console.error("Remove liquidity failed:", submitError);
      txError =
        submitError instanceof Error
          ? submitError.message
          : "Failed to remove liquidity";
      showErrorModal = true;
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div class="remove-liquidity-content">
  {#if hasOpenPositions}
    <div class="remove-warning" role="alert">
      If you use this tab directly, PnL tracking will stop working for all open
      positions. To keep track of your PnL and liquidity history, click "Close"
      on the positions instead of removing liquidity directly.
    </div>
  {/if}
  <TradeSettingsRow
    bind:open={swapSettingsOpen}
    settingsLabel={swapSettingsDisplay}
    dialogLabel="Liquidity settings"
    closeBackdropLabel="Close liquidity settings"
    bottomMargin="0"
  >
    {#snippet presets()}
      <DexPresetButtons
        items={removeQuickPresets.map(
          (preset) =>
            ({
              id: preset.key,
              label: preset.label,
              active:
                preset.percent !== null && removePercent === preset.percent,
              disabled: preset.disabled,
              insufficientDollar: preset.insufficientDollar,
              onClick: () => {
                if (preset.percent !== null) removePercent = preset.percent;
              },
            }) satisfies DexPresetButtonItem,
        )}
      />
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

  <div class="slider-wrapper">
    <div class="slider-header">
      <label class="slider-label" for="remove-percent-slider"
        >Amount to remove</label
      >
      <span class="slider-value">{removePercent}%</span>
    </div>
    <input
      id="remove-percent-slider"
      type="range"
      min="0"
      max="100"
      step="1"
      value={removePercent}
      oninput={(e) => (removePercent = parseInt(e.currentTarget.value, 10))}
      class="percent-slider"
      aria-describedby={txError && !showErrorModal
        ? "remove-liquidity-tx-error"
        : undefined}
    />
  </div>

  {#if removePreview && removePercent > 0}
    <div class="remove-preview-box">
      <div class="preview-header">You will receive</div>
      <div class="preview-token-row">
        <div class="preview-token">
          {#if token0 && getTokenIcon(token0)}
            <img
              src={getTokenIcon(token0)!}
              alt={token0.metadata.symbol}
              class="preview-token-icon"
            />
          {:else if token0}
            <div class="preview-token-icon-placeholder">
              {token0.metadata.symbol.charAt(0)}
            </div>
          {/if}
          <span class="preview-token-amount"
            >{formatAmount(parseFloat(removePreview.amount0Human))}</span
          >
          <span class="preview-token-symbol"
            >{token0?.metadata.symbol ?? "?"}</span
          >
        </div>
      </div>
      <div class="preview-token-row">
        <div class="preview-token">
          {#if token1 && getTokenIcon(token1)}
            <img
              src={getTokenIcon(token1)!}
              alt={token1.metadata.symbol}
              class="preview-token-icon"
            />
          {:else if token1}
            <div class="preview-token-icon-placeholder">
              {token1.metadata.symbol.charAt(0)}
            </div>
          {/if}
          <span class="preview-token-amount"
            >{formatAmount(parseFloat(removePreview.amount1Human))}</span
          >
          <span class="preview-token-symbol"
            >{token1?.metadata.symbol ?? "?"}</span
          >
        </div>
      </div>
      <div class="preview-total">
        <span class="preview-total-label">Total value</span>
        <span class="preview-total-value">
          {removePreview.usdValue > 0
            ? `$${formatAmount(removePreview.usdValue)}`
            : "—"}
        </span>
      </div>
    </div>

    <div class="estimation-box">
      <div class="estimation-row">
        <span class="estimation-label">Shares to remove</span>
        <span class="estimation-value"
          >{formatShares(removePreview.sharesToRemove)}</span
        >
      </div>
      <div class="estimation-row">
        <span class="estimation-label"
          >Min {token0?.metadata.symbol} received</span
        >
        <span class="estimation-value">
          {#if minAssetsReceivedForTx}
            {formatBalance(
              minAssetsReceivedForTx[0].toString(),
              token0?.metadata.decimals ?? 18,
            )}
          {:else}
            —
          {/if}
        </span>
      </div>
      <div class="estimation-row">
        <span class="estimation-label"
          >Min {token1?.metadata.symbol} received</span
        >
        <span class="estimation-value">
          {#if minAssetsReceivedForTx}
            {formatBalance(
              minAssetsReceivedForTx[1].toString(),
              token1?.metadata.decimals ?? 18,
            )}
          {:else}
            —
          {/if}
        </span>
      </div>
    </div>
  {/if}

  {#if txError && !showErrorModal}
    <div
      id="remove-liquidity-tx-error"
      class="warning-box error-box"
      role="alert"
      aria-live="assertive"
    >
      {txError}
    </div>
  {/if}

  <ErrorModal
    isOpen={showErrorModal}
    onClose={() => {
      showErrorModal = false;
      txError = null;
    }}
    title="Remove Liquidity Failed"
    message={txError ?? ""}
    isTransaction={true}
  />

  <button
    class="primary-btn remove-btn"
    onclick={handleRemoveLiquidity}
    disabled={!canRemove}
  >
    {#if isSubmitting}
      <Spinner tone="light" />
      Removing Liquidity...
    {:else if removePercent === 0}
      Select Amount
    {:else}
      Remove Liquidity
    {/if}
  </button>
</div>

<style>
  .remove-liquidity-content {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .slider-wrapper {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
    padding: 1rem 0.875rem;
  }
  .slider-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .slider-label {
    color: var(--text-secondary);
    font-size: 0.875rem;
  }
  .slider-value {
    color: var(--text-primary);
    font-size: 1.5rem;
    font-weight: 700;
    font-family: "JetBrains Mono", monospace;
  }
  .percent-slider {
    width: 100%;
    height: 8px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--border-color);
    border-radius: 4px;
    outline: none;
    cursor: pointer;
  }
  .percent-slider:focus-visible {
    outline: 2px solid var(--border-focus);
    outline-offset: 2px;
  }
  .percent-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--accent-button-small);
    cursor: pointer;
    border: 2px solid var(--bg-card);
  }
  .percent-slider::-moz-range-thumb {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--accent-button-small);
    cursor: pointer;
    border: 2px solid var(--bg-card);
  }
  .remove-preview-box {
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
    background: var(--bg-input);
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
    padding: 0.875rem;
  }
  .preview-header {
    color: var(--text-secondary);
    font-size: 0.8125rem;
    font-weight: 500;
  }
  .preview-token-row {
    display: flex;
    align-items: center;
  }
  .preview-token {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .preview-token-icon {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    object-fit: cover;
  }
  .preview-token-icon-placeholder {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent-primary), #2563eb);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
    color: white;
  }
  .preview-token-amount {
    color: var(--text-primary);
    font-size: 1rem;
    font-weight: 600;
    font-family: "JetBrains Mono", monospace;
  }
  .preview-token-symbol {
    color: var(--text-muted);
    font-size: 0.875rem;
  }
  .preview-total {
    display: flex;
    justify-content: space-between;
    padding-top: 0.625rem;
    border-top: 1px solid var(--border-color);
    margin-top: 0.25rem;
  }
  .preview-total-label {
    color: var(--text-secondary);
    font-size: 0.875rem;
  }
  .preview-total-value {
    color: var(--text-primary);
    font-size: 1.125rem;
    font-weight: 700;
    font-family: "JetBrains Mono", monospace;
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
  .remove-warning {
    background: rgba(245, 158, 11, 0.18);
    border: 1px solid rgba(245, 158, 11, 0.35);
    border-radius: 0.75rem;
    padding: 0.75rem 1rem;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }
  .warning-box {
    border-radius: 0.75rem;
    padding: 0.75rem 1rem;
    font-size: 0.8125rem;
  }
  .error-box {
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.25);
    color: #f87171;
  }
  .primary-btn {
    width: 100%;
    padding: 1rem 1.25rem;
    font-size: 1.25rem;
    font-weight: 600;
    border: none;
    border-radius: 0.75rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
  }
  .primary-btn.remove-btn {
    background: #dc2626;
  }
  .primary-btn.remove-btn:hover:not(:disabled) {
    background: #b91c1c;
  }
  .primary-btn.remove-btn:disabled {
    background: rgba(220, 38, 38, 0.45);
    opacity: 1;
    cursor: not-allowed;
  }
  .primary-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  @media (--mobile) {
    .slider-wrapper {
      padding: 0.625rem 0.75rem;
      gap: 0.375rem;
    }
    .slider-value {
      font-size: 1.25rem;
    }
    .remove-preview-box {
      padding: 0.625rem 0.75rem;
      gap: 0.375rem;
    }
    .preview-token-icon,
    .preview-token-icon-placeholder {
      width: 1.25rem;
      height: 1.25rem;
      font-size: 0.625rem;
    }
    .preview-token-amount {
      font-size: 1rem;
    }
    .preview-token-symbol {
      font-size: 0.75rem;
    }
  }
  @media (--small-mobile) {
    .slider-wrapper {
      padding: 0.5rem 0.625rem;
      gap: 0.25rem;
    }
    .slider-value {
      font-size: 1.125rem;
    }
    .percent-slider {
      height: 6px;
    }
    .percent-slider::-webkit-slider-thumb,
    .percent-slider::-moz-range-thumb {
      width: 16px;
      height: 16px;
    }
    .remove-preview-box {
      padding: 0.5rem 0.625rem;
      gap: 0.25rem;
    }
    .preview-token {
      gap: 0.375rem;
    }
    .preview-token-icon,
    .preview-token-icon-placeholder {
      width: 1.125rem;
      height: 1.125rem;
      font-size: 0.5625rem;
    }
    .preview-token-amount {
      font-size: 0.875rem;
    }
    .preview-token-symbol {
      font-size: 0.75rem;
    }
    .preview-total {
      padding-top: 0.375rem;
    }
  }
</style>
