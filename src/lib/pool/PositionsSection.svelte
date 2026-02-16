<script lang="ts">
  import { CLOSE_POSITION_AUTH_STORAGE_KEY, walletStore } from "../walletStore";
  import type { Token } from "../types";
  import {
    XykRemoveLiquidityArgsSchema,
    serializeToBase64,
  } from "../xykSchemas";
  import {
    AUTO_LIQUIDITY_SLIPPAGE_PERCENT,
    assertOutcomesSucceeded,
    DEX_BACKEND_API,
    DEX_CONTRACT_ID,
    DEX_ID,
  } from "./shared";
  import type { NormalizedPool } from "./shared";
  import ErrorModal from "../ErrorModal.svelte";
  import {
    parseLiquidityRemovedFromOutcomes,
    type LiquidityRemovedEventData,
  } from "./liquidityEvents";
  import Spinner from "../Spinner.svelte";
  import ResponsiveTooltip from "../ResponsiveTooltip.svelte";
  import {
    formatAmount,
    formatApy,
    formatRelativeDate,
    rawAmountToHumanReadable,
  } from "../utils";
  import { loadSwapSettingsConfig } from "../swapConfig";

  const NEP413_MESSAGE = "Sign in to Intear DEX for LP position tracking";
  const NEP413_RECIPIENT = "dex.intea.rs";

  function uint8ArrayToBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  interface AuthPayload {
    account_id: string;
    signature: string;
    public_key: string;
    nonce: string;
  }

  function getStoredAuthPayload(accountId: string): AuthPayload | null {
    try {
      const stored = localStorage.getItem(CLOSE_POSITION_AUTH_STORAGE_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored) as AuthPayload;
      if (parsed.account_id !== accountId) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function saveAuthPayload(payload: AuthPayload) {
    localStorage.setItem(
      CLOSE_POSITION_AUTH_STORAGE_KEY,
      JSON.stringify(payload),
    );
  }

  interface PositionBreakdownParams {
    amount0OpenNum: number;
    amount1OpenNum: number;
    amount0ClosedNum: number;
    amount1ClosedNum: number;
    price0OpenUsd: number;
    price1OpenUsd: number;
    price0NowUsd: number;
    price1NowUsd: number;
  }

  interface PositionBreakdown {
    openUsd: number;
    valueIfHeldNowUsd: number;
    impermanentLossUsd: number;
    feesRevenueUsd: number;
    priceGainUsd: number;
    totalPnlUsd: number;
  }

  function computePositionBreakdown({
    amount0OpenNum,
    amount1OpenNum,
    amount0ClosedNum,
    amount1ClosedNum,
    price0OpenUsd,
    price1OpenUsd,
    price0NowUsd,
    price1NowUsd,
  }: PositionBreakdownParams): PositionBreakdown {
    const openUsd =
      amount0OpenNum * price0OpenUsd + amount1OpenNum * price1OpenUsd;
    const closedUsd =
      amount0ClosedNum * price0NowUsd + amount1ClosedNum * price1NowUsd;
    const valueIfHeldNowUsd =
      amount0OpenNum * price0NowUsd + amount1OpenNum * price1NowUsd;
    const totalPnlUsd = closedUsd - openUsd;

    const entryRatio = amount0OpenNum / amount1OpenNum;
    const exitRatio = amount0ClosedNum / amount1ClosedNum;

    if (
      !Number.isFinite(entryRatio) ||
      !Number.isFinite(exitRatio) ||
      entryRatio <= 0 ||
      exitRatio <= 0 ||
      !Number.isFinite(price0NowUsd) ||
      !Number.isFinite(price1NowUsd)
    ) {
      return {
        openUsd,
        valueIfHeldNowUsd,
        impermanentLossUsd: 0,
        feesRevenueUsd: 0,
        priceGainUsd: totalPnlUsd,
        totalPnlUsd,
      };
    }

    const ratioChangeSqrt = Math.sqrt(exitRatio / entryRatio);
    const amount0NoFeeClose = amount0OpenNum * ratioChangeSqrt;
    const amount1NoFeeClose = amount1OpenNum / ratioChangeSqrt;

    const impermanentLossAmount0 = amount0NoFeeClose - amount0OpenNum;
    const impermanentLossAmount1 = amount1NoFeeClose - amount1OpenNum;
    const impermanentLossUsd =
      impermanentLossAmount0 * price0NowUsd +
      impermanentLossAmount1 * price1NowUsd;

    const feesAmount0 = amount0ClosedNum - amount0NoFeeClose;
    const feesAmount1 = amount1ClosedNum - amount1NoFeeClose;
    const feesRevenueUsd =
      feesAmount0 * price0NowUsd + feesAmount1 * price1NowUsd;

    const priceGainUsd = totalPnlUsd - impermanentLossUsd - feesRevenueUsd;

    return {
      openUsd,
      valueIfHeldNowUsd,
      impermanentLossUsd,
      feesRevenueUsd: feesRevenueUsd,
      priceGainUsd,
      totalPnlUsd,
    };
  }

  export interface OpenPosition {
    position_id: number;
    pool_id: number;
    shares: string;
    asset0_amount: string;
    asset1_amount: string;
    asset0_open_price_usd: number;
    asset1_open_price_usd: number;
    opened_at: string;
    transaction_hash: string;
  }

  export interface ClosedPosition {
    position_id: number;
    pool_id: number;
    shares: string;
    asset0_amount: string;
    asset1_amount: string;
    asset0_open_price_usd: number;
    asset1_open_price_usd: number;
    opened_at: string;
    transaction_hash: string;
    closed_at: string;
    closed_profit_usd: number;
    closed_asset0_amount: string;
    closed_asset1_amount: string;
    closed_asset0_price_usd: number;
    closed_asset1_price_usd: number;
    closed_transaction_hash: string;
  }

  interface Props {
    poolData: NormalizedPool | null;
    token0: Token | null;
    token1: Token | null;
    open: OpenPosition[];
    closed?: ClosedPosition[];
    poolId: number | null;
    onPositionClose: () => void | Promise<void>;
    onCloseSuccess: (payload: {
      eventData: LiquidityRemovedEventData;
      positionData: {
        asset0_amount: string;
        asset1_amount: string;
        asset0_open_price_usd: number;
        asset1_open_price_usd: number;
      };
      prices: {
        price0Usd: number;
        price1Usd: number;
      };
    }) => void;
  }

  let {
    poolData,
    token0,
    token1,
    open,
    closed = [],
    poolId,
    onPositionClose: onPositionClose,
    onCloseSuccess,
  }: Props = $props();

  let expandedPositionId = $state<number | null>(null);
  let isClosing = $state(false);
  let closeError = $state<string | null>(null);
  let hasStoredAuth = $state(false);
  let showCloseErrorModal = $state(false);

  $effect(() => {
    const accountId = $walletStore.accountId;
    hasStoredAuth = !!accountId && getStoredAuthPayload(accountId) !== null;
  });

  function toggleExpand(id: number) {
    expandedPositionId = expandedPositionId === id ? null : id;
  }

  async function handleClosePosition(pos: OpenPosition) {
    const accountId = $walletStore.accountId;
    const wallet = $walletStore.wallet;
    if (!accountId || !wallet || poolId === null) {
      closeError = "Connect wallet first";
      return;
    }
    if (!poolData || !poolData.totalSharesRaw) {
      closeError = "Pool data not loaded";
      return;
    }

    closeError = null;
    isClosing = true;

    try {
      if (token0 === null || token1 === null) {
        closeError = "Token data not loaded";
        return;
      }
      const prices = {
        price0Usd: parseFloat(token0.price_usd || "0"),
        price1Usd: parseFloat(token1.price_usd || "0"),
      };

      let payload: AuthPayload;

      const stored = getStoredAuthPayload(accountId);
      if (stored) {
        payload = stored;
      } else {
        const nonce = crypto.getRandomValues(new Uint8Array(32));
        const signed = await wallet.signMessage({
          message: NEP413_MESSAGE,
          recipient: NEP413_RECIPIENT,
          nonce,
        });
        payload = {
          account_id: signed.accountId,
          signature: signed.signature,
          public_key: signed.publicKey,
          nonce: uint8ArrayToBase64(nonce),
        };
        saveAuthPayload(payload);
        hasStoredAuth = true;
        return;
      }

      const bearerToken = JSON.stringify(payload);
      const response = await fetch(`${DEX_BACKEND_API}/track/intent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearerToken}`,
        },
        body: JSON.stringify({
          intent: {
            type: "ClosePlach",
            position_id: pos.position_id,
            pool_id: poolId,
          },
        }),
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(errBody ?? `HTTP ${response.status}`);
      }

      const slippageConfig = loadSwapSettingsConfig();
      const effectiveSlippagePercent =
        slippageConfig.mode === "auto"
          ? AUTO_LIQUIDITY_SLIPPAGE_PERCENT
          : slippageConfig.value;
      const slippageBps = BigInt(
        Math.min(
          10000,
          Math.max(0, Math.round(effectiveSlippagePercent * 100)),
        ),
      );
      const totalPoolShares = BigInt(poolData.totalSharesRaw);
      const poolBalance0 = BigInt(poolData.assets[0].balance);
      const poolBalance1 = BigInt(poolData.assets[1].balance);
      const sharesToRemove = BigInt(pos.shares);
      const amount0Raw = (sharesToRemove * poolBalance0) / totalPoolShares;
      const amount1Raw = (sharesToRemove * poolBalance1) / totalPoolShares;
      const min0 = (amount0Raw * (10000n - slippageBps)) / 10000n;
      const min1 = (amount1Raw * (10000n - slippageBps)) / 10000n;

      const operations = [
        {
          DexCall: {
            dex_id: DEX_ID,
            method: "remove_liquidity",
            args: serializeToBase64(XykRemoveLiquidityArgsSchema, {
              pool_id: poolId,
              shares_to_remove: sharesToRemove,
              min_assets_received: [min0, min1],
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
        const positionData = {
          asset0_amount: pos.asset0_amount,
          asset1_amount: pos.asset1_amount,
          asset0_open_price_usd: pos.asset0_open_price_usd,
          asset1_open_price_usd: pos.asset1_open_price_usd,
        };
        onCloseSuccess({
          eventData: removedEvent,
          positionData,
          prices: prices,
        });
      }
      await onPositionClose();
    } catch (err) {
      console.error("Close position failed:", err);
      closeError =
        err instanceof Error ? err.message : "Failed to close position";
      showCloseErrorModal = true;
    } finally {
      isClosing = false;
    }
  }

  const positionsWithBreakdown = $derived.by(() => {
    if (
      !poolData ||
      !token0 ||
      !token1 ||
      !poolData.totalSharesRaw ||
      open.length === 0
    ) {
      return [];
    }

    const totalPoolShares = BigInt(poolData.totalSharesRaw);
    const poolBalance0 = BigInt(poolData.assets[0].balance);
    const poolBalance1 = BigInt(poolData.assets[1].balance);
    const price0 = parseFloat(token0.price_usd);
    const price1 = parseFloat(token1.price_usd);

    return open
      .flatMap((pos) => {
        const shares = BigInt(pos.shares);
        if (shares <= 0n || totalPoolShares <= 0n) return [];

        const amount0Raw = (shares * poolBalance0) / totalPoolShares;
        const amount1Raw = (shares * poolBalance1) / totalPoolShares;
        const amount0Human = rawAmountToHumanReadable(
          amount0Raw.toString(),
          token0.metadata.decimals,
        );
        const amount1Human = rawAmountToHumanReadable(
          amount1Raw.toString(),
          token1.metadata.decimals,
        );
        const amount0Num = parseFloat(amount0Human);
        const amount1Num = parseFloat(amount1Human);
        const currentUsd = amount0Num * price0 + amount1Num * price1;

        const asset0HumanOpen = rawAmountToHumanReadable(
          pos.asset0_amount,
          token0.metadata.decimals,
        );
        const asset1HumanOpen = rawAmountToHumanReadable(
          pos.asset1_amount,
          token1.metadata.decimals,
        );
        const amount0OpenNum = parseFloat(asset0HumanOpen);
        const amount1OpenNum = parseFloat(asset1HumanOpen);
        const breakdown = computePositionBreakdown({
          amount0OpenNum,
          amount1OpenNum,
          price0OpenUsd: pos.asset0_open_price_usd,
          price1OpenUsd: pos.asset1_open_price_usd,
          price0NowUsd: price0,
          price1NowUsd: price1,
          amount0ClosedNum: amount0Num,
          amount1ClosedNum: amount1Num,
        });
        const pnl = breakdown.totalPnlUsd;

        const openedAt = new Date(pos.opened_at);

        const nowTime = Date.now();
        const durationMs = nowTime - openedAt.getTime();
        const durationYears = durationMs / (1000 * 60 * 60 * 24 * 365.25);
        let feesApyPercent: number | null = null;
        if (breakdown.openUsd > 0 && durationYears > 0) {
          const totalReturn = breakdown.feesRevenueUsd / breakdown.openUsd;
          feesApyPercent = (totalReturn / durationYears) * 100;
        }

        return [
          {
            ...pos,
            amount0Num,
            amount1Num,
            currentUsd,
            amount0OpenNum,
            amount1OpenNum,
            openUsd: breakdown.openUsd,
            valueIfHeld: breakdown.valueIfHeldNowUsd,
            impermanentLossUsd: breakdown.impermanentLossUsd,
            feesRevenueUsd: breakdown.feesRevenueUsd,
            feesApyPercent,
            priceGainUsd: breakdown.priceGainUsd,
            pnl,
            openedAt,
          },
        ];
      })
      .toSorted((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
  });

  const closedWithBreakdown = $derived.by(() => {
    if (!token0 || !token1 || closed.length === 0) return [];
    return closed
      .map((pos) => {
        const closedAt = new Date(pos.closed_at);
        const openedAt = new Date(pos.opened_at);
        const asset0ClosedHuman = rawAmountToHumanReadable(
          pos.closed_asset0_amount,
          token0.metadata.decimals,
        );
        const asset1ClosedHuman = rawAmountToHumanReadable(
          pos.closed_asset1_amount,
          token1.metadata.decimals,
        );
        const asset0OpenHuman = rawAmountToHumanReadable(
          pos.asset0_amount,
          token0.metadata.decimals,
        );
        const asset1OpenHuman = rawAmountToHumanReadable(
          pos.asset1_amount,
          token1.metadata.decimals,
        );
        const amount0OpenNum = parseFloat(asset0OpenHuman);
        const amount1OpenNum = parseFloat(asset1OpenHuman);
        const amount0ClosedNum = parseFloat(asset0ClosedHuman);
        const amount1ClosedNum = parseFloat(asset1ClosedHuman);
        const closedUsd =
          amount0ClosedNum * pos.closed_asset0_price_usd +
          amount1ClosedNum * pos.closed_asset1_price_usd;
        const breakdown = computePositionBreakdown({
          amount0OpenNum,
          amount1OpenNum,
          amount0ClosedNum,
          amount1ClosedNum,
          price0OpenUsd: pos.asset0_open_price_usd,
          price1OpenUsd: pos.asset1_open_price_usd,
          price0NowUsd: pos.closed_asset0_price_usd,
          price1NowUsd: pos.closed_asset1_price_usd,
        });

        const durationMs = closedAt.getTime() - openedAt.getTime();
        const durationYears = durationMs / (1000 * 60 * 60 * 24 * 365.25);
        let feesApyPercent: number | null = null;
        if (breakdown.openUsd > 0 && durationYears > 0) {
          const totalReturn = breakdown.feesRevenueUsd / breakdown.openUsd;
          feesApyPercent = (totalReturn / durationYears) * 100;
        }

        return {
          ...pos,
          closedAt,
          openedAt,
          asset0ClosedHuman,
          asset1ClosedHuman,
          asset0OpenHuman,
          asset1OpenHuman,
          openUsd: breakdown.openUsd,
          closedUsd,
          valueIfHeldClosed: breakdown.valueIfHeldNowUsd,
          impermanentLossUsd: breakdown.impermanentLossUsd,
          feesRevenueUsd: breakdown.feesRevenueUsd,
          feesApyPercent,
          priceGainUsd: breakdown.priceGainUsd,
        };
      })
      .toSorted((a, b) => b.closedAt.getTime() - a.closedAt.getTime());
  });
</script>

{#if (open != null && open.length > 0 && positionsWithBreakdown.length > 0) || (closed != null && closed.length > 0)}
  <aside class="positions-section">
    <div class="positions-title">Positions</div>
    {#if closeError && !showCloseErrorModal}
      <div class="close-error" role="alert">{closeError}</div>
    {/if}

    <ErrorModal
      isOpen={showCloseErrorModal}
      onClose={() => {
        showCloseErrorModal = false;
        closeError = null;
      }}
      title="Close Position Failed"
      message={closeError ?? ""}
      isTransaction={true}
    />

    {#if open.length > 0 && positionsWithBreakdown.length > 0}
      <div class="positions-table">
        {#each positionsWithBreakdown as pos, i (pos.position_id)}
          {@const isExpanded = expandedPositionId === pos.position_id}
          {@const isOdd = i % 2 === 1}
          <div
            class="position-row"
            class:expanded={isExpanded}
            class:odd={isOdd}
            class:even={!isOdd}
          >
            <button
              type="button"
              class="position-row-main"
              onclick={() => toggleExpand(pos.position_id)}
              aria-expanded={isExpanded}
            >
              <div class="position-cell position-value">
                {pos.currentUsd > 0 ? `$${formatAmount(pos.currentUsd)}` : "—"}
              </div>
              <div class="position-cell position-opened">
                {formatRelativeDate(pos.openedAt)}
              </div>
              <span class="position-expand-icon" aria-hidden="true">
                {isExpanded ? "▼" : "▶"}
              </span>
            </button>
            {#if isExpanded}
              <div class="position-details">
                <div class="details-grid">
                  <ResponsiveTooltip title="Opened At">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Opened At</span>
                        <span class="detail-value">
                          {pos.openedAt.toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          You opened this position at
                          <span class="detail-tooltip-inline-value">
                            {pos.openedAt.toLocaleString(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Prices when opened">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Prices when opened</span>
                        <span class="detail-value">
                          {(token0?.metadata.symbol ?? "?") +
                            ": $" +
                            formatAmount(pos.asset0_open_price_usd)}
                          <br />
                          {(token1?.metadata.symbol ?? "?") +
                            ": $" +
                            formatAmount(pos.asset1_open_price_usd)}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          At open, prices were
                          <span
                            class="detail-tooltip-inline-value detail-tooltip-value-multiline"
                          >
                            {(token0?.metadata.symbol ?? "?") +
                              ": $" +
                              formatAmount(pos.asset0_open_price_usd)}
                            <br />
                            {(token1?.metadata.symbol ?? "?") +
                              ": $" +
                              formatAmount(pos.asset1_open_price_usd)}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Prices now">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Prices now</span>
                        <span class="detail-value">
                          {(token0?.metadata.symbol ?? "?") +
                            ": $" +
                            formatAmount(parseFloat(token0?.price_usd ?? "0"))}
                          <br />
                          {(token1?.metadata.symbol ?? "?") +
                            ": $" +
                            formatAmount(parseFloat(token1?.price_usd ?? "0"))}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          Current prices are
                          <span
                            class="detail-tooltip-inline-value detail-tooltip-value-multiline"
                          >
                            {(token0?.metadata.symbol ?? "?") +
                              ": $" +
                              formatAmount(
                                parseFloat(token0?.price_usd ?? "0"),
                              )}
                            <br />
                            {(token1?.metadata.symbol ?? "?") +
                              ": $" +
                              formatAmount(
                                parseFloat(token1?.price_usd ?? "0"),
                              )}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Amounts when opened">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Amounts when opened</span>
                        <span class="detail-value">
                          {formatAmount(pos.amount0OpenNum)}
                          {token0?.metadata.symbol ?? "?"}
                          + {formatAmount(pos.amount1OpenNum)}
                          {token1?.metadata.symbol ?? "?"}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          You supplied
                          <span class="detail-tooltip-inline-value">
                            {formatAmount(pos.amount0OpenNum)}
                            {token0?.metadata.symbol ?? "?"}
                            + {formatAmount(pos.amount1OpenNum)}
                            {token1?.metadata.symbol ?? "?"}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Amounts now">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Amounts now</span>
                        <span class="detail-value">
                          {formatAmount(pos.amount0Num)}
                          {token0?.metadata.symbol ?? "?"}
                          +
                          {formatAmount(pos.amount1Num)}
                          {token1?.metadata.symbol ?? "?"}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          This position currently represents
                          <span class="detail-tooltip-inline-value">
                            {formatAmount(pos.amount0Num)}
                            {token0?.metadata.symbol ?? "?"}
                            +
                            {formatAmount(pos.amount1Num)}
                            {token1?.metadata.symbol ?? "?"}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Value when opened">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Value when opened</span>
                        <span class="detail-value">
                          {pos.openUsd > 0
                            ? `$${formatAmount(pos.openUsd)}`
                            : "—"}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          When you opened this position, it was worth
                          <span class="detail-tooltip-inline-value">
                            {pos.openUsd > 0
                              ? `$${formatAmount(pos.openUsd)}`
                              : "—"}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Value if held tokens">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Value if held tokens</span>
                        <span class="detail-value">
                          {pos.valueIfHeld > 0
                            ? `$${formatAmount(pos.valueIfHeld)}`
                            : "—"}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          If you just held the tokens, without providing
                          liquidity, this would now be worth
                          <span class="detail-tooltip-inline-value">
                            {pos.valueIfHeld > 0
                              ? `$${formatAmount(pos.valueIfHeld)}`
                              : "—"}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Impermanent Loss">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Impermanent Loss</span>
                        <span
                          class="detail-value"
                          class:pnl-negative={pos.impermanentLossUsd < 0}
                        >
                          {pos.impermanentLossUsd < 0 ? "-" : ""}${formatAmount(
                            Math.abs(pos.impermanentLossUsd),
                          )}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          The ideal scenario for liquidity providers is when
                          there is volume, but prices stay the same, or increase
                          / decrease together. But if the prices move
                          differently, you accumulate impermanent loss. It's
                          called impermanent loss because if prices return to
                          the original ratio, the loss will be gone. Your
                          impermanent loss is currently
                          <span
                            class="detail-tooltip-inline-value"
                            class:detail-tooltip-value-negative={pos.impermanentLossUsd <
                              0}
                          >
                            {pos.impermanentLossUsd < 0
                              ? "-"
                              : ""}${formatAmount(
                              Math.abs(pos.impermanentLossUsd),
                            )}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Fees Revenue">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Fees Revenue</span>
                        <span
                          class="detail-value"
                          class:pnl-positive={pos.feesRevenueUsd > 0}
                          class:pnl-negative={pos.feesRevenueUsd < 0}
                        >
                          {pos.feesRevenueUsd > 0
                            ? "+"
                            : pos.feesRevenueUsd < 0
                              ? "-"
                              : ""}${formatAmount(Math.abs(pos.feesRevenueUsd))}
                          {#if pos.feesApyPercent !== null && Number.isFinite(pos.feesApyPercent)}
                            <span class="apy-badge">
                              ({formatApy(pos.feesApyPercent)} APY)
                            </span>
                          {/if}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          If the pool has fees, each liquidity provider earns a
                          share of each trade, proportionate to the amount of
                          liquidity they provide, and that's the primary source
                          of revenue for liquidity providers. Your revenue from
                          fees is currently
                          <span
                            class="detail-tooltip-inline-value"
                            class:detail-tooltip-value-positive={pos.feesRevenueUsd >
                              0}
                            class:detail-tooltip-value-negative={pos.feesRevenueUsd <
                              0}
                          >
                            {pos.feesRevenueUsd > 0
                              ? "+"
                              : pos.feesRevenueUsd < 0
                                ? "-"
                                : ""}${formatAmount(
                              Math.abs(pos.feesRevenueUsd),
                            )}
                          </span>
                          {#if pos.feesApyPercent !== null && Number.isFinite(pos.feesApyPercent)}
                            , which annualizes to
                            <span class="detail-tooltip-inline-value">
                              {formatApy(pos.feesApyPercent)} APY
                            </span>
                          {/if}
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Price Change">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Price Change</span>
                        <span
                          class="detail-value"
                          class:pnl-positive={pos.priceGainUsd > 0}
                          class:pnl-negative={pos.priceGainUsd < 0}
                        >
                          {pos.priceGainUsd > 0
                            ? "+"
                            : pos.priceGainUsd < 0
                              ? "-"
                              : ""}${formatAmount(Math.abs(pos.priceGainUsd))}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          Your liquidity position is represented by a certain
                          share of tokens in the pool. If the price of these
                          tokens goes up, value of your position goes up as
                          well. Currently, your PnL from price change is
                          <span
                            class="detail-tooltip-inline-value"
                            class:detail-tooltip-value-positive={pos.priceGainUsd >
                              0}
                            class:detail-tooltip-value-negative={pos.priceGainUsd <
                              0}
                          >
                            {pos.priceGainUsd > 0
                              ? "+"
                              : pos.priceGainUsd < 0
                                ? "-"
                                : ""}${formatAmount(Math.abs(pos.priceGainUsd))}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <div class="detail-item detail-item-static">
                    <span class="detail-label">Transaction</span>
                    <a
                      href="https://nearblocks.io/txns/{pos.transaction_hash}"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="detail-link"
                    >
                      View on NearBlocks ↗
                    </a>
                  </div>

                  <ResponsiveTooltip title="Net PnL">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Net PnL</span>
                        <span
                          class="detail-value"
                          class:pnl-positive={pos.pnl > 0}
                          class:pnl-negative={pos.pnl < 0}
                        >
                          {pos.pnl > 0
                            ? "+"
                            : pos.pnl < 0
                              ? "-"
                              : ""}${formatAmount(Math.abs(pos.pnl))}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          Your net PnL (including all factors above) from this
                          position is currently
                          <span
                            class="detail-tooltip-inline-value"
                            class:detail-tooltip-value-positive={pos.pnl > 0}
                            class:detail-tooltip-value-negative={pos.pnl < 0}
                          >
                            {pos.pnl > 0
                              ? "+"
                              : pos.pnl < 0
                                ? "-"
                                : ""}${formatAmount(Math.abs(pos.pnl))}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>
                </div>
                <button
                  type="button"
                  class="close-position-btn"
                  onclick={(e) => {
                    e.stopPropagation();
                    handleClosePosition(pos);
                  }}
                  disabled={isClosing || !$walletStore.isConnected}
                  aria-busy={isClosing}
                >
                  {#if isClosing}
                    <Spinner tone="light" />
                    {hasStoredAuth ? "Closing…" : "Signing…"}
                  {:else}
                    {hasStoredAuth ? "Close Position" : "Close Position (1/2)"}
                  {/if}
                </button>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
    {#if closed != null && closedWithBreakdown.length > 0}
      <div class="positions-separator">Closed positions</div>
      <div class="positions-table">
        {#each closedWithBreakdown as pos, i (pos.position_id)}
          {@const isExpanded = expandedPositionId === pos.position_id}
          {@const isOdd = i % 2 === 1}
          <div
            class="position-row"
            class:expanded={isExpanded}
            class:odd={isOdd}
            class:even={!isOdd}
          >
            <button
              type="button"
              class="position-row-main"
              onclick={() => toggleExpand(pos.position_id)}
              aria-expanded={isExpanded}
            >
              <div
                class="position-cell position-value"
                class:pnl-positive={pos.closed_profit_usd > 0}
                class:pnl-negative={pos.closed_profit_usd < 0}
              >
                {pos.closed_profit_usd > 0 ? "+" : ""}${formatAmount(
                  pos.closed_profit_usd,
                )}
              </div>
              <div class="position-cell position-opened">
                {formatRelativeDate(pos.closedAt)}
              </div>
              <span class="position-expand-icon" aria-hidden="true">
                {isExpanded ? "▼" : "▶"}
              </span>
            </button>
            {#if isExpanded}
              <div class="position-details">
                <div class="details-grid">
                  <ResponsiveTooltip title="Opened at">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Opened at</span>
                        <span class="detail-value">
                          {pos.openedAt.toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          You opened this position at
                          <span class="detail-tooltip-inline-value">
                            {pos.openedAt.toLocaleString(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Closed at">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Closed at</span>
                        <span class="detail-value">
                          {pos.closedAt.toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          You closed this position at
                          <span class="detail-tooltip-inline-value">
                            {pos.closedAt.toLocaleString(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                            })}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Prices when opened">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Prices when opened</span>
                        <span class="detail-value">
                          {(token0?.metadata.symbol ?? "?") +
                            ": $" +
                            formatAmount(pos.asset0_open_price_usd)}
                          <br />
                          {(token1?.metadata.symbol ?? "?") +
                            ": $" +
                            formatAmount(pos.asset1_open_price_usd)}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          At open, prices were
                          <span
                            class="detail-tooltip-inline-value detail-tooltip-value-multiline"
                          >
                            {(token0?.metadata.symbol ?? "?") +
                              ": $" +
                              formatAmount(pos.asset0_open_price_usd)}
                            <br />
                            {(token1?.metadata.symbol ?? "?") +
                              ": $" +
                              formatAmount(pos.asset1_open_price_usd)}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Prices when closed">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Prices when closed</span>
                        <span class="detail-value">
                          {(token0?.metadata.symbol ?? "?") +
                            ": $" +
                            formatAmount(pos.closed_asset0_price_usd)}
                          <br />
                          {(token1?.metadata.symbol ?? "?") +
                            ": $" +
                            formatAmount(pos.closed_asset1_price_usd)}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          At close, prices were
                          <span
                            class="detail-tooltip-inline-value detail-tooltip-value-multiline"
                          >
                            {(token0?.metadata.symbol ?? "?") +
                              ": $" +
                              formatAmount(pos.closed_asset0_price_usd)}
                            <br />
                            {(token1?.metadata.symbol ?? "?") +
                              ": $" +
                              formatAmount(pos.closed_asset1_price_usd)}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Amounts when opened">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Amounts when opened</span>
                        <span class="detail-value">
                          {formatAmount(parseFloat(pos.asset0OpenHuman))}
                          {token0?.metadata.symbol ?? "?"}
                          + {formatAmount(parseFloat(pos.asset1OpenHuman))}
                          {token1?.metadata.symbol ?? "?"}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          You supplied
                          <span class="detail-tooltip-inline-value">
                            {formatAmount(parseFloat(pos.asset0OpenHuman))}
                            {token0?.metadata.symbol ?? "?"}
                            + {formatAmount(parseFloat(pos.asset1OpenHuman))}
                            {token1?.metadata.symbol ?? "?"}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Amounts when closed">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Amounts when closed</span>
                        <span class="detail-value">
                          {formatAmount(parseFloat(pos.asset0ClosedHuman))}
                          {token0?.metadata.symbol ?? "?"}
                          + {formatAmount(parseFloat(pos.asset1ClosedHuman))}
                          {token1?.metadata.symbol ?? "?"}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          You received
                          <span class="detail-tooltip-inline-value">
                            {formatAmount(parseFloat(pos.asset0ClosedHuman))}
                            {token0?.metadata.symbol ?? "?"}
                            + {formatAmount(parseFloat(pos.asset1ClosedHuman))}
                            {token1?.metadata.symbol ?? "?"}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Value when opened">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Value when opened</span>
                        <span class="detail-value">
                          {pos.openUsd > 0
                            ? `$${formatAmount(pos.openUsd)}`
                            : "—"}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          When you opened this position, it was worth
                          <span class="detail-tooltip-inline-value">
                            {pos.openUsd > 0
                              ? `$${formatAmount(pos.openUsd)}`
                              : "—"}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Value when closed">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Value when closed</span>
                        <span class="detail-value">
                          {pos.closedUsd > 0
                            ? `$${formatAmount(pos.closedUsd)}`
                            : "—"}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          When you closed this position, it was worth
                          <span class="detail-tooltip-inline-value">
                            {pos.closedUsd > 0
                              ? `$${formatAmount(pos.closedUsd)}`
                              : "—"}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Value if held tokens">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Value if held tokens</span>
                        <span class="detail-value">
                          {pos.valueIfHeldClosed > 0
                            ? `$${formatAmount(pos.valueIfHeldClosed)}`
                            : "—"}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          If you just held the tokens, without providing
                          liquidity, this would be worth
                          <span class="detail-tooltip-inline-value">
                            {pos.valueIfHeldClosed > 0
                              ? `$${formatAmount(pos.valueIfHeldClosed)}`
                              : "—"}
                          </span>
                          at the time you closed this position.
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Impermanent Loss">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Impermanent Loss</span>
                        <span
                          class="detail-value"
                          class:pnl-negative={pos.impermanentLossUsd < 0}
                        >
                          {pos.impermanentLossUsd < 0 ? "-" : ""}${formatAmount(
                            Math.abs(pos.impermanentLossUsd),
                          )}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          The ideal scenario for liquidity providers is when
                          there is volume, but prices stay the same, or increase
                          / decrease together. But if the prices move
                          differently, you accumulate impermanent loss. It's
                          called impermanent loss because if prices return to
                          the original ratio, the loss will be gone. Your
                          impermanent loss for this position was
                          <span
                            class="detail-tooltip-inline-value"
                            class:detail-tooltip-value-negative={pos.impermanentLossUsd <
                              0}
                          >
                            {pos.impermanentLossUsd < 0
                              ? "-"
                              : ""}${formatAmount(
                              Math.abs(pos.impermanentLossUsd),
                            )}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Fees Revenue">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Fees Revenue</span>
                        <span
                          class="detail-value"
                          class:pnl-positive={pos.feesRevenueUsd > 0}
                          class:pnl-negative={pos.feesRevenueUsd < 0}
                        >
                          {pos.feesRevenueUsd > 0
                            ? "+"
                            : pos.feesRevenueUsd < 0
                              ? "-"
                              : ""}${formatAmount(Math.abs(pos.feesRevenueUsd))}
                          {#if pos.feesApyPercent !== null && Number.isFinite(pos.feesApyPercent)}
                            <span class="apy-badge">
                              ({formatApy(pos.feesApyPercent)} APY)
                            </span>
                          {/if}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          If the pool has fees, each liquidity provider earns a
                          share of each trade, proportionate to the amount of
                          liquidity they provide, and that's the primary source
                          of revenue for liquidity providers. Your revenue from
                          fees for this position was
                          <span
                            class="detail-tooltip-inline-value"
                            class:detail-tooltip-value-positive={pos.feesRevenueUsd >
                              0}
                            class:detail-tooltip-value-negative={pos.feesRevenueUsd <
                              0}
                          >
                            {pos.feesRevenueUsd > 0
                              ? "+"
                              : pos.feesRevenueUsd < 0
                                ? "-"
                                : ""}${formatAmount(
                              Math.abs(pos.feesRevenueUsd),
                            )}
                          </span>
                          {#if pos.feesApyPercent !== null && Number.isFinite(pos.feesApyPercent)}
                            , which annualized to
                            <span class="detail-tooltip-inline-value">
                              {formatApy(pos.feesApyPercent)} APY
                            </span>
                          {/if}
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <ResponsiveTooltip title="Price Change">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Price Change</span>
                        <span
                          class="detail-value"
                          class:pnl-positive={pos.priceGainUsd > 0}
                          class:pnl-negative={pos.priceGainUsd < 0}
                        >
                          {pos.priceGainUsd > 0
                            ? "+"
                            : pos.priceGainUsd < 0
                              ? "-"
                              : ""}${formatAmount(Math.abs(pos.priceGainUsd))}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          Your liquidity position is represented by a certain
                          share of tokens in the pool. If the price of these
                          tokens goes up, value of your position goes up as
                          well. Your PnL from price change for this position was
                          <span
                            class="detail-tooltip-inline-value"
                            class:detail-tooltip-value-positive={pos.priceGainUsd >
                              0}
                            class:detail-tooltip-value-negative={pos.priceGainUsd <
                              0}
                          >
                            {pos.priceGainUsd > 0
                              ? "+"
                              : pos.priceGainUsd < 0
                                ? "-"
                                : ""}${formatAmount(Math.abs(pos.priceGainUsd))}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>

                  <div class="detail-item detail-item-static">
                    <span class="detail-label">Transactions</span>
                    <a
                      href="https://nearblocks.io/txns/{pos.transaction_hash}"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="detail-link"
                    >
                      Open ↗
                    </a>
                    <a
                      href="https://nearblocks.io/txns/{pos.closed_transaction_hash}"
                      target="_blank"
                      rel="noopener noreferrer"
                      class="detail-link"
                    >
                      Close ↗
                    </a>
                  </div>

                  <ResponsiveTooltip title="Net PnL">
                    {#snippet children()}
                      <div class="detail-item">
                        <span class="detail-label">Net PnL</span>
                        <span
                          class="detail-value"
                          class:pnl-positive={pos.closed_profit_usd > 0}
                          class:pnl-negative={pos.closed_profit_usd < 0}
                        >
                          {pos.closed_profit_usd > 0
                            ? "+"
                            : pos.closed_profit_usd < 0
                              ? "-"
                              : ""}${formatAmount(
                            Math.abs(pos.closed_profit_usd),
                          )}
                        </span>
                      </div>
                    {/snippet}
                    {#snippet content()}
                      <div class="detail-tooltip-content">
                        <div class="detail-tooltip-description">
                          Your net PnL (including all factors above) from this
                          position was
                          <span
                            class="detail-tooltip-inline-value"
                            class:detail-tooltip-value-positive={pos.closed_profit_usd >
                              0}
                            class:detail-tooltip-value-negative={pos.closed_profit_usd <
                              0}
                          >
                            {pos.closed_profit_usd > 0
                              ? "+"
                              : pos.closed_profit_usd < 0
                                ? "-"
                                : ""}${formatAmount(
                              Math.abs(pos.closed_profit_usd),
                            )}
                          </span>
                        </div>
                      </div>
                    {/snippet}
                  </ResponsiveTooltip>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </aside>
{/if}

<style>
  .positions-section {
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 1.25rem;
    box-shadow:
      0 4px 6px -1px rgba(0, 0, 0, 0.3),
      0 2px 4px -2px rgba(0, 0, 0, 0.2),
      0 0 0 1px rgba(59, 130, 246, 0.05);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .positions-title {
    color: var(--text-primary);
    font-size: 0.875rem;
    font-weight: 700;
  }

  .close-error {
    font-size: 0.75rem;
    color: #ef4444;
  }

  .positions-table {
    display: flex;
    flex-direction: column;
  }

  .position-row {
    overflow: hidden;
    border: 1px solid transparent;
  }

  .position-row:first-child {
    border-radius: 0.5rem 0.5rem 0 0;
  }

  .position-row:last-child {
    border-radius: 0 0 0.5rem 0.5rem;
  }

  .position-row:first-child:last-child {
    border-radius: 0.5rem;
  }

  .position-row.even .position-row-main {
    background: rgba(0, 0, 0, 0.15);
  }

  .position-row.odd .position-row-main {
    background: rgba(255, 255, 255, 0.02);
  }

  .position-row.odd.expanded,
  .position-row.even.expanded {
    background: var(--bg-input);
  }

  .position-row.expanded {
    border-color: var(--border-color);
    background: var(--bg-input);
  }

  .positions-separator {
    color: var(--text-muted);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-color);
  }

  .position-cell.position-value.pnl-positive {
    color: #22c55e;
  }

  .position-cell.position-value.pnl-negative {
    color: #ef4444;
  }

  .position-row-main {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    padding: 0.625rem 0.75rem;
    background: transparent;
    border: none;
    cursor: pointer;
    color: inherit;
    font-family: inherit;
    font-size: inherit;
    text-align: left;
    transition: background 0.15s ease;
  }

  .position-row-main:hover {
    background: rgba(255, 255, 255, 0.06) !important;
  }

  .position-cell {
    flex: 1;
    min-width: 0;
    font-size: 0.8125rem;
  }

  .position-value {
    color: var(--text-primary);
    font-weight: 600;
    font-family: "JetBrains Mono", monospace;
  }

  .position-opened {
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .position-expand-icon {
    flex-shrink: 0;
    color: var(--text-muted);
    font-size: 0.625rem;
    transition: transform 0.2s ease;
  }

  .position-details {
    padding: 0 0.75rem 0.75rem 0.75rem;
    padding-top: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .close-position-btn {
    align-self: flex-end;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.375rem 0.625rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: #f87171;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 0.5rem;
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s;
  }

  .close-position-btn:hover:not(:disabled) {
    background: rgba(239, 68, 68, 0.18);
    border-color: rgba(239, 68, 68, 0.45);
  }

  .close-position-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .details-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem;
    border-top: 1px solid var(--border-color);
  }

  .detail-item {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
    cursor: help;
  }

  .detail-item-static {
    cursor: default;
  }

  .detail-label {
    color: var(--text-muted);
    font-size: 0.875rem;
  }

  .detail-item:hover .detail-label {
    color: var(--text-secondary);
  }

  .detail-tooltip-content {
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-family: "JetBrains Mono", monospace;
    line-height: 1.35;
  }

  .detail-tooltip-description {
    margin-bottom: 0.5rem;
  }

  .detail-tooltip-inline-value {
    font-weight: 600;
  }

  .detail-tooltip-value-multiline {
    text-align: right;
  }

  .detail-tooltip-value-positive {
    color: var(--success, #22c55e);
  }

  .detail-tooltip-value-negative {
    color: var(--error, #ef4444);
  }

  .detail-value {
    color: var(--text-secondary);
    font-size: 1rem;
    font-family: "JetBrains Mono", monospace;
  }

  .detail-link {
    color: var(--accent-primary);
    font-size: 0.8125rem;
    text-decoration: none;
  }

  .detail-link:hover {
    color: var(--accent-hover);
    text-decoration: underline;
  }

  .detail-value.pnl-positive {
    color: #22c55e;
  }

  .detail-value.pnl-negative {
    color: #ef4444;
  }

  .apy-badge {
    font-size: 0.875rem;
    margin-left: 0.375rem;
    font-weight: 500;
  }

  @media (--mobile) {
    .positions-section {
      gap: 0.5rem;
      padding: 1rem;
    }

    .positions-title {
      font-size: 0.8125rem;
    }

    .position-row-main {
      padding: 0.5rem;
    }

    .position-cell {
      font-size: 0.75rem;
    }

    .details-grid {
      margin-left: 0;
      padding: 0.25rem;
    }
  }

  @media (--small-mobile) {
    .positions-section {
      padding: 0.75rem;
    }

    .positions-title {
      font-size: 0.75rem;
    }

    .detail-label,
    .detail-value {
      font-size: 0.785rem;
    }
  }
</style>
