<script lang="ts">
  import { onDestroy } from "svelte";
  import TokenIcon from "./TokenIcon.svelte";
  import { createChatwootModalVisibilityController } from "./chatwootBubbleVisibility";
  import { walletStore } from "./walletStore";
  import { tokenHubStore } from "./tokenHubStore";
  import {
    assetIdToTokenId,
    assertOutcomesSucceeded,
    DEX_CONTRACT_ID,
    DEX_ID,
  } from "./pool/shared";
  import {
    DEX_BACKEND_API,
    formatAmount,
    formatUsdValue,
  } from "./utils";
  import type { TokenInfo } from "./types";
  import Spinner from "./Spinner.svelte";
  import ErrorModal from "./ErrorModal.svelte";
  import {
    assetId,
    serializeToBase64,
    type ArgsXykGetPendingFees,
    XykGetPendingFeesArgsSchema,
  } from "./xykSchemas";
  import { extractIncomingTransfersFromOutcomes } from "./transferEvents";

  let isConnecting = $state(false);
  let balancesFetchedForAccount = $state<string | null>(null);
  let isBalanceDataLoading = $state(false);
  let balancePopoverOpen = $state(false);
  let isPopoverPinned = $state(false);
  let isMobileViewport = $state(false);
  let walletData = $state<{
    balances: Record<string, string>;
    pending_fees: Record<string, string>;
  } | null>(null);
  let withdrawalError = $state<string | null>(null);
  let showWithdrawalErrorModal = $state(false);
  let activeWithdrawalKeys = $state<Set<string>>(new Set());

  const chatwootModalVisibility = createChatwootModalVisibilityController();

  type BalanceRow = {
    assetId: string;
    amount: string;
    symbol: string;
    token: TokenInfo | null;
    usdValue: number;
  };

  type WalletDataSource = "balances" | "pending_fees";

  function getWithdrawalKey(source: WalletDataSource, assetId: string): string {
    return `${source}:${assetId}`;
  }

  function isWithdrawalPending(source: WalletDataSource, assetId: string): boolean {
    return activeWithdrawalKeys.has(getWithdrawalKey(source, assetId));
  }

  function setWithdrawalPending(
    source: WalletDataSource,
    assetId: string,
    pending: boolean,
  ): void {
    const key = getWithdrawalKey(source, assetId);
    const next = new Set(activeWithdrawalKeys);
    if (pending) {
      next.add(key);
    } else {
      next.delete(key);
    }
    activeWithdrawalKeys = next;
  }

  function toSchemaAssetId(rawAssetId: string) {
    if (rawAssetId === "near") {
      return assetId("Near");
    }
    if (rawAssetId.startsWith("nep141:")) {
      return assetId("Nep141", rawAssetId.slice("nep141:".length));
    }
    throw new Error(`Unsupported asset ID: ${rawAssetId}`);
  }

  function removeRowFromWalletData(
    source: WalletDataSource,
    assetId: string,
  ): void {
    if (!walletData) return;

    if (source === "balances") {
      const rest = { ...walletData.balances };
      delete rest[assetId];
      walletData = {
        ...walletData,
        balances: rest,
      };
      return;
    }

    if (source === "pending_fees") {
      const rest = { ...walletData.pending_fees };
      delete rest[assetId];
      walletData = {
        ...walletData,
        pending_fees: rest,
      };
      return;
    }

    throw new Error(`Unsupported source: ${source}`);
  }

  function hasIncomingTransferForAsset(
    outcomes: unknown,
    accountId: string,
    assetId: string,
  ): boolean {
    const expectedTokenId = assetIdToTokenId(assetId);
    if (!expectedTokenId) return false;

    const incomingTransfers = extractIncomingTransfersFromOutcomes(
      outcomes,
      accountId,
    );
    const acceptableTokenIds =
      expectedTokenId === "near"
        ? new Set(["near", "wrap.near"])
        : new Set([expectedTokenId]);

    return incomingTransfers.some((transfer) =>
      acceptableTokenIds.has(transfer.tokenId),
    );
  }

  async function handleWithdrawFromSource(
    source: WalletDataSource,
    row: BalanceRow,
  ): Promise<void> {
    const wallet = $walletStore.wallet;
    const accountId = $walletStore.accountId;
    if (!wallet || !accountId) {
      return;
    }
    if (isWithdrawalPending(source, row.assetId)) {
      return;
    }

    setWithdrawalPending(source, row.assetId, true);
    try {
      let outcomes: unknown;

      if (source === "balances") {
        const transactions = [
          {
            receiverId: DEX_CONTRACT_ID,
            actions: [
              {
                type: "FunctionCall" as const,
                params: {
                  methodName: "withdraw",
                  args: {
                    asset_id: row.assetId,
                    amount: {
                      Full: {
                        at_least: null,
                      },
                    },
                  },
                  gas: "120" + "0".repeat(12),
                  deposit: "1",
                },
              },
            ],
          },
        ];
        outcomes = await wallet.signAndSendTransactions({ transactions });
      } else {
        const withdrawFeesArgs: ArgsXykGetPendingFees = {
          asset_ids: [toSchemaAssetId(row.assetId)],
        };
        const operations = [
          {
            DexCall: {
              dex_id: DEX_ID,
              method: "withdraw_fees",
              args: serializeToBase64(
                XykGetPendingFeesArgsSchema,
                withdrawFeesArgs,
              ),
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
        outcomes = await wallet.signAndSendTransactions({ transactions });
      }

      assertOutcomesSucceeded(outcomes);
      if (!hasIncomingTransferForAsset(outcomes, accountId, row.assetId)) {
        throw new Error(
          `Transaction went through but no ${row.symbol} received, something went wrong. Please try again or contact support.`,
        );
      }

      removeRowFromWalletData(source, row.assetId);
      tokenHubStore.refreshBalances();
    } catch (error) {
      console.error("Withdrawal failed:", error);
      withdrawalError =
        error instanceof Error
          ? error.message
          : source === "balances"
            ? "Failed to withdraw internal balance"
            : "Failed to withdraw collected fees";
      showWithdrawalErrorModal = true;
    } finally {
      setWithdrawalPending(source, row.assetId, false);
    }
  }

  async function handleWithdrawInternalBalance(row: BalanceRow): Promise<void> {
    await handleWithdrawFromSource("balances", row);
  }

  async function handleWithdrawCollectedFee(row: BalanceRow): Promise<void> {
    await handleWithdrawFromSource("pending_fees", row);
  }

  function buildRows(source: Record<string, string>): BalanceRow[] {
    const rows = Object.entries(source)
      .filter(([, raw]) => parseInt(raw) > 0)
      .map(([assetId, raw]) => {
        const tokenId = assetIdToTokenId(assetId);
        const token = tokenId ? $tokenHubStore.tokensById[tokenId] : null;
        if (!token) {
          return null;
        }
        const decimals = token.metadata.decimals;
        const priceUsd = parseFloat(token.price_usd);
        const amount = parseFloat(raw) / Math.pow(10, decimals);
        const usdValue = amount * priceUsd;
        return {
          assetId,
          amount: formatAmount(amount),
          symbol: token.metadata.symbol,
          token,
          usdValue,
        };
      })
      .filter((r) => r !== null)
      .sort((a, b) => b.usdValue - a.usdValue);

    return rows;
  }

  const internalBalanceRows = $derived(buildRows(walletData?.balances ?? {}));
  const collectedFeeRows = $derived(buildRows(walletData?.pending_fees ?? {}));
  const hasNonZeroWalletData = $derived(
    internalBalanceRows.length > 0 || collectedFeeRows.length > 0,
  );
  const totalWalletUsd = $derived(
    [...internalBalanceRows, ...collectedFeeRows].reduce(
      (sum, row) => sum + row.usdValue,
      0,
    ),
  );
  const showWalletValueBadge = $derived(totalWalletUsd >= 1);
  const rowIconSize = $derived(isMobileViewport ? 24 : 20);

  async function fetchWalletInternalBalances(): Promise<void> {
    if (isBalanceDataLoading) return;
    isBalanceDataLoading = true;
    try {
      const response = await fetch(
        `${DEX_BACKEND_API}/balances?accountId=${$walletStore.accountId}`,
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch balances: HTTP ${response.status}`);
      }
      walletData = (await response.json()) as {
        balances: Record<string, string>;
        pending_fees: Record<string, string>;
      };

      const tokenIds = new Set<string>();
      for (const assetId of [
        ...Object.keys(walletData.balances),
        ...Object.keys(walletData.pending_fees),
      ]) {
        const tokenId = assetIdToTokenId(assetId);
        if (tokenId) tokenIds.add(tokenId);
      }
      await Promise.all(
        [...tokenIds].map((tokenId) => tokenHubStore.ensureTokenById(tokenId)),
      );
    } catch (error) {
      console.error("Failed to fetch wallet badge balances:", error);
      walletData = null;
    } finally {
      isBalanceDataLoading = false;
    }
  }

  $effect(() => {
    const mediaQuery = window.matchMedia("(max-width: 640px)");
    const applyMatch = () => {
      isMobileViewport = mediaQuery.matches;
      if (mediaQuery.matches) {
        isPopoverPinned = false;
      }
    };
    applyMatch();
    mediaQuery.addEventListener("change", applyMatch);
    return () => mediaQuery.removeEventListener("change", applyMatch);
  });

  $effect(() => {
    const accountId = $walletStore.accountId;
    if (!$walletStore.isConnected || !accountId) {
      balancesFetchedForAccount = null;
      walletData = null;
      balancePopoverOpen = false;
      isPopoverPinned = false;
      return;
    }
    if (balancesFetchedForAccount === accountId) return;
    balancesFetchedForAccount = accountId;
    fetchWalletInternalBalances();
  });

  $effect(() => {
    if (!showWithdrawalErrorModal) return;
    balancePopoverOpen = false;
    isPopoverPinned = false;
  });

  $effect(() => {
    chatwootModalVisibility.setVisible(isMobileViewport && balancePopoverOpen);
  });

  onDestroy(() => {
    chatwootModalVisibility.dispose();
  });

  function toggleWalletPopoverFromBadge() {
    if (!hasNonZeroWalletData) return;
    if (isMobileViewport) {
      balancePopoverOpen = !balancePopoverOpen;
      return;
    }

    isPopoverPinned = !isPopoverPinned;
    balancePopoverOpen = isPopoverPinned;
  }

  function handleAccountWrapperClick(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest(".account-badge")) return;
    toggleWalletPopoverFromBadge();
  }

  function handleAccountWrapperKeydown(event: KeyboardEvent) {
    if (!hasNonZeroWalletData) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleWalletPopoverFromBadge();
  }

  function openPopover() {
    balancePopoverOpen = true;
  }

  function closePopoverIfNotPinned() {
    if (isMobileViewport) return;
    if (!isPopoverPinned) {
      balancePopoverOpen = false;
    }
  }

  function handleDesktopHoverOpen() {
    if (isMobileViewport) return;
    openPopover();
  }

  function closePinnedPopover(event?: Event) {
    event?.stopPropagation();
    isPopoverPinned = false;
    balancePopoverOpen = false;
  }

  function closeMobileModal(event?: Event) {
    event?.stopPropagation();
    balancePopoverOpen = false;
  }

  function handleMobileBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      event.stopPropagation();
      closeMobileModal();
    }
  }

  function handleMobileBackdropKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      closeMobileModal();
    }
  }

  async function handleConnect() {
    isConnecting = true;
    try {
      await walletStore.connect();
    } catch (error) {
      console.error("Connection failed:", error);
    } finally {
      isConnecting = false;
    }
  }

  async function handleDisconnect() {
    try {
      await walletStore.disconnect();
    } catch (error) {
      console.error("Disconnect failed:", error);
    }
  }
</script>

{#if $walletStore.isConnected && $walletStore.accountId}
  <div class="wallet-connected">
    {#if hasNonZeroWalletData && balancePopoverOpen && isPopoverPinned && !isMobileViewport}
      <button
        type="button"
        class="wallet-popover-backdrop"
        aria-label="Close balances popover"
        onclick={closePinnedPopover}
      ></button>
    {/if}
    <div
      class="account-wrapper"
      class:clickable={hasNonZeroWalletData}
      class:expanded={hasNonZeroWalletData &&
        balancePopoverOpen &&
        !isMobileViewport}
      role="button"
      tabindex="0"
      aria-expanded={hasNonZeroWalletData ? balancePopoverOpen : undefined}
      onmouseenter={handleDesktopHoverOpen}
      onmouseleave={closePopoverIfNotPinned}
      onclick={handleAccountWrapperClick}
      onkeydown={handleAccountWrapperKeydown}
    >
      <div class="account-badge">
        <div class="account-icon"></div>
        <span class="account-id">{$walletStore.accountId}</span>
        {#if showWalletValueBadge}
          <span class="wallet-value-badge">
            {formatUsdValue(totalWalletUsd)}
          </span>
        {/if}
      </div>

      {#if hasNonZeroWalletData && balancePopoverOpen}
        {#if isMobileViewport}
          <div
            class="mobile-tooltip-backdrop"
            role="button"
            tabindex="0"
            aria-label="Close balances modal"
            onclick={handleMobileBackdropClick}
            onkeydown={handleMobileBackdropKeydown}
          >
            <div
              class="mobile-tooltip-sheet"
              role="dialog"
              tabindex="0"
              aria-modal="true"
              aria-label="Balances details"
              onclick={(event) => event.stopPropagation()}
              onkeydown={(event) => event.stopPropagation()}
            >
              <div class="mobile-tooltip-header">
                <div class="mobile-tooltip-title">Balances</div>
                <button
                  type="button"
                  class="mobile-tooltip-close"
                  onclick={closeMobileModal}
                  aria-label="Close"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div class="wallet-popover-section">
                <h4>Collected Fees</h4>
                {#if collectedFeeRows.length === 0}
                  <p class="empty-text">No collected fees</p>
                {:else}
                  <ul>
                    {#each collectedFeeRows as row (row.assetId)}
                      {@const isPending = isWithdrawalPending("pending_fees", row.assetId)}
                      <li>
                        <div class="token-row-main">
                          {#if row.token}
                            <TokenIcon token={row.token} size={rowIconSize} />
                          {/if}
                          <div class="token-texts">
                            {row.amount}
                            {row.symbol}
                            <span class="token-usd"
                              >{formatUsdValue(row.usdValue)}</span
                            >
                          </div>
                        </div>
                        <div class="token-row-actions">
                          <button
                            type="button"
                            class="withdraw-btn"
                            disabled={isPending}
                            onclick={() => handleWithdrawCollectedFee(row)}
                          >
                            {#if isPending}
                              <Spinner size={12} tone="light" />
                              Withdrawing...
                            {:else}
                              Withdraw
                            {/if}
                          </button
                          >
                        </div>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
              <div class="wallet-popover-section">
                <h4>Internal Balances</h4>
                {#if internalBalanceRows.length === 0}
                  <p class="empty-text">No internal balances</p>
                {:else}
                  <ul>
                    {#each internalBalanceRows as row (row.assetId)}
                      {@const isPending = isWithdrawalPending("balances", row.assetId)}
                      <li>
                        <div class="token-row-main">
                          {#if row.token}
                            <TokenIcon token={row.token} size={rowIconSize} />
                          {/if}
                          <div class="token-texts">
                            {row.amount}
                            {row.symbol}
                            <span class="token-usd"
                              >{formatUsdValue(row.usdValue)}</span
                            >
                          </div>
                        </div>
                        <div class="token-row-actions">
                          <button
                            type="button"
                            class="withdraw-btn"
                            disabled={isPending}
                            onclick={() => handleWithdrawInternalBalance(row)}
                          >
                            {#if isPending}
                              <Spinner size={12} tone="light" />
                              Withdrawing...
                            {:else}
                              Withdraw
                            {/if}
                          </button
                          >
                        </div>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            </div>
          </div>
        {:else}
          <div class="wallet-popover">
            <div class="wallet-popover-section">
              <h4>Collected Fees</h4>
              {#if collectedFeeRows.length === 0}
                <p class="empty-text">No collected fees</p>
              {:else}
                <ul>
                  {#each collectedFeeRows as row (row.assetId)}
                    {@const isPending = isWithdrawalPending("pending_fees", row.assetId)}
                    <li>
                      <div class="token-row-main">
                        {#if row.token}
                          <TokenIcon token={row.token} size={rowIconSize} />
                        {/if}
                        <div class="token-texts">
                          {row.amount}
                          {row.symbol}
                          <span class="token-usd"
                            >{formatUsdValue(row.usdValue)}</span
                          >
                        </div>
                      </div>
                      <div class="token-row-actions">
                        <button
                          type="button"
                          class="withdraw-btn"
                          disabled={isPending}
                          onclick={() => handleWithdrawCollectedFee(row)}
                        >
                          {#if isPending}
                            <Spinner size={12} tone="light" />
                            Withdrawing...
                          {:else}
                            Withdraw
                          {/if}
                        </button
                        >
                      </div>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
            <div class="wallet-popover-section">
              <h4>Internal Balances</h4>
              {#if internalBalanceRows.length === 0}
                <p class="empty-text">No internal balances</p>
              {:else}
                <ul>
                  {#each internalBalanceRows as row (row.assetId)}
                    {@const isPending = isWithdrawalPending("balances", row.assetId)}
                    <li>
                      <div class="token-row-main">
                        {#if row.token}
                          <TokenIcon token={row.token} size={rowIconSize} />
                        {/if}
                        <div class="token-texts">
                          {row.amount}
                          {row.symbol}
                          <span class="token-usd"
                            >{formatUsdValue(row.usdValue)}</span
                          >
                        </div>
                      </div>
                      <div class="token-row-actions">
                        <button
                          type="button"
                          class="withdraw-btn"
                          disabled={isPending}
                          onclick={() => handleWithdrawInternalBalance(row)}
                        >
                          {#if isPending}
                            <Spinner size={12} tone="light" />
                            Withdrawing...
                          {:else}
                            Withdraw
                          {/if}
                        </button
                        >
                      </div>
                    </li>
                  {/each}
                </ul>
              {/if}
            </div>
          </div>
        {/if}
      {/if}
    </div>
    <button class="disconnect-btn" onclick={handleDisconnect}>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      Disconnect
    </button>
  </div>
{:else}
  <button class="connect-btn" onclick={handleConnect} disabled={isConnecting}>
    {#if isConnecting}
      <Spinner size={14} tone="light" />
      Connecting...
    {:else}
      Connect Wallet
    {/if}
  </button>
{/if}

<ErrorModal
  isOpen={showWithdrawalErrorModal}
  onClose={() => {
    showWithdrawalErrorModal = false;
    withdrawalError = null;
  }}
  message={withdrawalError ?? ""}
  isTransaction
/>

<style>
  .wallet-connected {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .account-wrapper {
    position: relative;
  }

  .account-wrapper.clickable .account-badge {
    cursor: pointer;
  }

  .account-wrapper.expanded {
    z-index: 60;
  }

  .account-wrapper.expanded .account-badge {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
    border-bottom-color: transparent;
  }

  .wallet-popover-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    border: none;
    background: transparent;
    padding: 0;
    margin: 0;
    cursor: default;
  }

  .account-badge {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 0.875rem;
    height: 2.5rem;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 0.75rem;
  }

  .account-icon {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--accent-primary), #10b981);
    box-shadow: 0 0 8px rgba(59, 130, 246, 0.5);
  }

  .account-id {
    font-size: 0.875rem;
    font-weight: 600;
    font-family: "JetBrains Mono", monospace;
    color: var(--text-primary);
  }

  .wallet-value-badge {
    border: 1px solid color-mix(in oklab, var(--accent-primary), black 20%);
    background: color-mix(in oklab, var(--accent-primary), black 10%);
    color: white;
    border-radius: 999px;
    font-size: 0.75rem;
    font-weight: 700;
    line-height: 1;
    padding: 0.25rem 0.5rem;
  }

  .wallet-popover {
    position: absolute;
    top: calc(100% - 1px);
    right: 0;
    width: min(25rem, 88vw);
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-top: none;
    border-radius: 0.75rem 0 0.75rem 0.75rem;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    z-index: 50;
    box-shadow: 0 14px 24px -16px rgba(0, 0, 0, 0.45);
  }

  .wallet-popover-section {
    padding: 0.25rem;
  }

  .wallet-popover-section h4 {
    margin: 0 0 0.5rem;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    letter-spacing: 0.01em;
    text-transform: uppercase;
  }

  .wallet-popover-section ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .wallet-popover-section li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: 2.5rem;
  }

  .token-row-main {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    flex: 1;
  }

  .token-texts {
    min-width: 0;
    display: flex;
    flex-direction: column;
    word-break: break-word;
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text-primary);
    font-family: "JetBrains Mono", monospace;
  }

  .token-row-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .token-usd {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .withdraw-btn {
    min-width: 6.5rem;
    height: 2.125rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.35rem;
    border: none;
    background: var(--accent-button-small);
    color: white;
    border-radius: 0.625rem;
    padding: 0 0.875rem;
    font-size: 0.8125rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .withdraw-btn:hover {
    background: var(--accent-hover);
  }

  .withdraw-btn:disabled {
    opacity: 0.75;
    cursor: not-allowed;
  }

  .withdraw-btn:disabled:hover {
    background: var(--accent-button-small);
  }

  .empty-text {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .mobile-tooltip-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    z-index: 1101;
    display: flex;
    align-items: flex-end;
  }

  .mobile-tooltip-sheet {
    width: 100%;
    background: var(--bg-card);
    border-top: 1px solid var(--border-color);
    border-radius: 1rem 1rem 0 0;
    padding: 1rem 1.25rem 1.5rem;
    box-shadow: 0 -12px 20px -8px rgba(0, 0, 0, 0.5);
    user-select: none;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .mobile-tooltip-sheet .wallet-popover-section h4 {
    font-size: 0.875rem;
  }

  .mobile-tooltip-sheet .wallet-popover-section li {
    min-height: 2.75rem;
  }

  .mobile-tooltip-sheet .token-usd {
    font-size: 0.8125rem;
  }

  .mobile-tooltip-sheet .withdraw-btn {
    min-width: 7rem;
    height: 2.25rem;
    font-size: 0.875rem;
  }

  .mobile-tooltip-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.375rem;
    gap: 1rem;
  }

  .mobile-tooltip-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .mobile-tooltip-close {
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .mobile-tooltip-close:hover {
    background: var(--bg-input);
    color: var(--text-primary);
  }

  .connect-btn,
  .disconnect-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0 1.25rem;
    height: 2.5rem;
    background: var(--accent-button-small);
    border: none;
    border-radius: 0.75rem;
    color: white;
    font-size: 0.9375rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    white-space: nowrap;
  }

  .connect-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .connect-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .disconnect-btn {
    background: transparent;
    border: 1px solid var(--border-color);
    color: var(--text-secondary);
    padding: 0 0.875rem;
  }

  .disconnect-btn:hover {
    background: var(--bg-input);
    border-color: #ef4444;
    color: #ef4444;
  }

  @media (--tablet) {
    .wallet-connected {
      gap: 0.5rem;
    }

    .account-badge {
      padding: 0 0.75rem;
      height: 2.25rem;
    }

    .account-id {
      font-size: 0.8125rem;
      text-overflow: ellipsis;
    }

    .wallet-popover {
      right: 0;
    }

    .connect-btn,
    .disconnect-btn {
      padding: 0 1rem;
      height: 2.25rem;
      font-size: 0.875rem;
    }

    .disconnect-btn {
      padding: 0 0.75rem;
    }
  }

  @media (--mobile) {
    .wallet-connected {
      flex-wrap: wrap;
      gap: 0.5rem;
      width: 100%;
    }

    .account-wrapper {
      flex: 1;
      min-width: 0;
    }

    .account-badge {
      flex: 1;
      min-width: 0;
      padding: 0 0.625rem;
      height: 2rem;
    }

    .account-id {
      font-size: 0.75rem;
      overflow: hidden;
    }

    .wallet-value-badge {
      font-size: 0.6875rem;
      padding: 0.2rem 0.4rem;
    }

    .connect-btn {
      padding: 0 1rem;
      height: 2rem;
      font-size: 0.875rem;
    }

    .disconnect-btn {
      padding: 0 0.625rem;
      height: 2rem;
      gap: 0.375rem;
    }

    .disconnect-btn svg {
      width: 14px;
      height: 14px;
    }
  }

  @media (--small-mobile) {
    .account-badge {
      padding: 0 0.5rem;
      height: 1.875rem;
    }

    .account-id {
      font-size: 0.6875rem;
    }

    .connect-btn,
    .disconnect-btn {
      padding: 0 0.5rem;
      height: 1.875rem;
    }
  }

</style>
