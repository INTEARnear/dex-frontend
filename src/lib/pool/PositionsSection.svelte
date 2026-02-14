<script lang="ts">
  import { walletStore } from "../walletStore";
  import type { Token } from "../types";
  import {
    XykRemoveLiquidityArgsSchema,
    serializeToBase64,
  } from "../xykSchemas";
  import {
    assertOutcomesSucceeded,
    AUTO_MAX_SLIPPAGE_PERCENT,
    DEX_BACKEND_API,
    DEX_CONTRACT_ID,
    DEX_ID,
  } from "./shared";
  import type { NormalizedPool } from "./shared";
  import ErrorModal from "../ErrorModal.svelte";
  import RemovedLiquidityModal from "./RemovedLiquidityModal.svelte";
  import { parseLiquidityRemovedFromOutcomes } from "./liquidityEvents";
  import {
    formatAmount,
    formatRelativeDate,
    rawAmountToHumanReadable,
  } from "../utils";
  import type { SlippageMode } from "../SwapSettings.svelte";

  const NEP413_MESSAGE = "Sign in to Intear DEX for LP position tracking";
  const NEP413_RECIPIENT = "dex.intea.rs";
  const STORAGE_KEY_PREFIX = "intear_dex_close_position_auth_";

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
      const stored = localStorage.getItem(`${STORAGE_KEY_PREFIX}${accountId}`);
      if (!stored) return null;
      return JSON.parse(stored) as AuthPayload;
    } catch {
      return null;
    }
  }

  function saveAuthPayload(accountId: string, payload: AuthPayload): void {
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}${accountId}`,
      JSON.stringify(payload),
    );
  }

  function loadSwapSettingsConfig(): { mode: SlippageMode; value: number } {
    try {
      const saved = localStorage.getItem("intear-dex-slippage");
      if (saved) return JSON.parse(saved);
    } catch {}
    return { mode: "auto", value: 0 };
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
    /** Called with success payload when position is closed; when provided, parent owns the success modal */
    onCloseSuccess?: (payload: {
      eventData: import("./liquidityEvents").LiquidityRemovedEventData;
      snapshot: import("./RemovedLiquidityModal.svelte").RemovedLiquiditySnapshot;
      positionData: {
        asset0_amount: string;
        asset1_amount: string;
        asset0_open_price_usd: number;
        asset1_open_price_usd: number;
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
  let showCloseSuccessModal = $state(false);
  let closeSuccessEventData = $state<import("./liquidityEvents").LiquidityRemovedEventData | null>(null);
  let closeSuccessSnapshot = $state<import("./RemovedLiquidityModal.svelte").RemovedLiquiditySnapshot | null>(null);
  let closedPositionForModal = $state<{
    asset0_amount: string;
    asset1_amount: string;
    asset0_open_price_usd: number;
    asset1_open_price_usd: number;
  } | null>(null);

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
        saveAuthPayload(accountId, payload);
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
          ? AUTO_MAX_SLIPPAGE_PERCENT
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
              type: "FunctionCall" as const,
              params: {
                methodName: "execute_operations",
                args: { operations },
                gas: "120" + "0".repeat(12),
                deposit: "1",
              },
            },
          ],
        },
      ];

      const outcomes = await wallet.signAndSendTransactions({ transactions });
      assertOutcomesSucceeded(outcomes);

      const removedEvent = parseLiquidityRemovedFromOutcomes(outcomes);
      if (removedEvent && token0 && token1) {
        const positionData = {
          asset0_amount: pos.asset0_amount,
          asset1_amount: pos.asset1_amount,
          asset0_open_price_usd: pos.asset0_open_price_usd,
          asset1_open_price_usd: pos.asset1_open_price_usd,
        };
        const snapshot = {
          symbol0: token0.metadata.symbol,
          symbol1: token1.metadata.symbol,
          decimals0: token0.metadata.decimals,
          decimals1: token1.metadata.decimals,
          price0Usd: parseFloat(token0.price_usd || "0"),
          price1Usd: parseFloat(token1.price_usd || "0"),
        };
        if (onCloseSuccess) {
          onCloseSuccess({ eventData: removedEvent, snapshot, positionData });
        } else {
          closeSuccessEventData = removedEvent;
          closedPositionForModal = positionData;
          closeSuccessSnapshot = snapshot;
          showCloseSuccessModal = true;
        }
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

    return open.flatMap((pos) => {
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
      const openUsd =
        amount0OpenNum * pos.asset0_open_price_usd +
        amount1OpenNum * pos.asset1_open_price_usd;
      const valueIfHeld = amount0OpenNum * price0 + amount1OpenNum * price1;
      const pnl = currentUsd - openUsd;

      const openedAt = new Date(pos.opened_at);

      return [
        {
          ...pos,
          amount0Num,
          amount1Num,
          currentUsd,
          amount0OpenNum,
          amount1OpenNum,
          openUsd,
          valueIfHeld,
          pnl,
          openedAt,
        },
      ];
    });
  });

  const closedWithBreakdown = $derived.by(() => {
    if (!token0 || !token1 || closed.length === 0) return [];
    return closed.map((pos) => {
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
      const openUsd =
        parseFloat(asset0OpenHuman) * pos.asset0_open_price_usd +
        parseFloat(asset1OpenHuman) * pos.asset1_open_price_usd;
      const closedUsd =
        parseFloat(asset0ClosedHuman) * pos.closed_asset0_price_usd +
        parseFloat(asset1ClosedHuman) * pos.closed_asset1_price_usd;
      return {
        ...pos,
        closedAt,
        openedAt,
        asset0ClosedHuman,
        asset1ClosedHuman,
        asset0OpenHuman,
        asset1OpenHuman,
        openUsd,
        closedUsd,
      };
    });
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

    {#if !onCloseSuccess}
      <RemovedLiquidityModal
        isOpen={showCloseSuccessModal}
        onClose={() => {
          showCloseSuccessModal = false;
          closeSuccessEventData = null;
          closedPositionForModal = null;
          closeSuccessSnapshot = null;
        }}
        eventData={closeSuccessEventData}
        snapshot={closeSuccessSnapshot}
        {token0}
        {token1}
        isPositionClose={true}
        positionData={closedPositionForModal}
      />
    {/if}

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
                  <div class="detail-item">
                    <span class="detail-label">Opened</span>
                    <span class="detail-value">
                      {pos.openedAt.toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
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
                  <div class="detail-item">
                    <span class="detail-label">Amounts when opened</span>
                    <span class="detail-value">
                      {formatAmount(pos.amount0OpenNum)}
                      {token0?.metadata.symbol ?? "?"}
                      + {formatAmount(pos.amount1OpenNum)}
                      {token1?.metadata.symbol ?? "?"}
                    </span>
                  </div>
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
                  <div class="detail-item">
                    <span class="detail-label">Value when opened</span>
                    <span class="detail-value">
                      {pos.openUsd > 0 ? `$${formatAmount(pos.openUsd)}` : "—"}
                    </span>
                  </div>
                  <div class="detail-item">
                    <span class="detail-label">Value if just held tokens</span>
                    <span class="detail-value">
                      {pos.valueIfHeld > 0
                        ? `$${formatAmount(pos.valueIfHeld)}`
                        : "—"}
                    </span>
                  </div>
                  {#if pos.transaction_hash}
                    <div class="detail-item">
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
                  {/if}
                  <div class="detail-item">
                    <span class="detail-label">PnL</span>
                    <span
                      class="detail-value"
                      class:pnl-positive={pos.pnl > 0}
                      class:pnl-negative={pos.pnl < 0}
                    >
                      {pos.pnl > 0 ? "+" : ""}${formatAmount(pos.pnl)}
                    </span>
                  </div>
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
                    <span class="spinner small"></span>
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
                  <div class="detail-item">
                    <span class="detail-label">Closed</span>
                    <span class="detail-value">
                      {pos.closedAt.toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
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
                  <div class="detail-item">
                    <span class="detail-label">Amounts when opened</span>
                    <span class="detail-value">
                      {formatAmount(parseFloat(pos.asset0OpenHuman))}
                      {token0?.metadata.symbol ?? "?"}
                      + {formatAmount(parseFloat(pos.asset1OpenHuman))}
                      {token1?.metadata.symbol ?? "?"}
                    </span>
                  </div>
                  <div class="detail-item">
                    <span class="detail-label">Amounts when closed</span>
                    <span class="detail-value">
                      {formatAmount(parseFloat(pos.asset0ClosedHuman))}
                      {token0?.metadata.symbol ?? "?"}
                      + {formatAmount(parseFloat(pos.asset1ClosedHuman))}
                      {token1?.metadata.symbol ?? "?"}
                    </span>
                  </div>
                  <div class="detail-item">
                    <span class="detail-label">Opened</span>
                    <span class="detail-value">
                      {pos.openedAt.toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  <div class="detail-item">
                    <span class="detail-label">Value when opened</span>
                    <span class="detail-value">
                      {pos.openUsd > 0 ? `$${formatAmount(pos.openUsd)}` : "—"}
                    </span>
                  </div>
                  <div class="detail-item">
                    <span class="detail-label">Value when closed</span>
                    <span class="detail-value">
                      {pos.closedUsd > 0
                        ? `$${formatAmount(pos.closedUsd)}`
                        : "—"}
                    </span>
                  </div>
                  {#if pos.transaction_hash}
                    <div class="detail-item">
                      <span class="detail-label">Open transaction</span>
                      <a
                        href="https://nearblocks.io/txns/{pos.transaction_hash}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="detail-link"
                      >
                        View on NearBlocks ↗
                      </a>
                    </div>
                  {/if}
                  {#if pos.closed_transaction_hash}
                    <div class="detail-item">
                      <span class="detail-label">Close transaction</span>
                      <a
                        href="https://nearblocks.io/txns/{pos.closed_transaction_hash}"
                        target="_blank"
                        rel="noopener noreferrer"
                        class="detail-link"
                      >
                        View on NearBlocks ↗
                      </a>
                    </div>
                  {/if}
                  <div class="detail-item">
                    <span class="detail-label">Profit / Loss</span>
                    <span
                      class="detail-value"
                      class:pnl-positive={pos.closed_profit_usd > 0}
                      class:pnl-negative={pos.closed_profit_usd < 0}
                    >
                      {pos.closed_profit_usd > 0 ? "+" : ""}${formatAmount(
                        pos.closed_profit_usd,
                      )}
                    </span>
                  </div>
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

  .spinner {
    display: inline-block;
    border-radius: 50%;
    border: 3px solid var(--border-color);
    border-top-color: var(--accent-primary);
    animation: spin 0.8s linear infinite;
  }

  .spinner.small {
    width: 1rem;
    height: 1rem;
    border-width: 2px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .details-grid {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border-color);
    margin-left: 1.5rem;
  }

  .detail-item {
    display: flex;
    flex-direction: column;
    gap: 0.125rem;
  }

  .detail-label {
    color: var(--text-muted);
    font-size: 0.875rem;
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
