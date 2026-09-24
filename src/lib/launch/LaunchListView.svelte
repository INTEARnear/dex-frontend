<script lang="ts">
  import ListPageToolbar from "$lib/ListPageToolbar.svelte";
  import type { TokenInfo } from "$lib/types";
  import { getTokenIcon } from "$lib/utils";
  import { walletStore } from "$lib/walletStore";

  interface Props {
    visibleLaunchTokens: TokenInfo[];
    selectedTokenId: string | null;
    sortByLabel: string;
    searchQuery: string;
    ownedFirst: boolean;
    onCreateTokenClick: () => void;
    onCycleSortBy: () => void;
    onSearchQueryChange: (next: string) => void;
    onOwnedFirstChange: (next: boolean) => void;
    formatMarketCap: (token: TokenInfo) => string;
  }

  let {
    visibleLaunchTokens,
    selectedTokenId,
    sortByLabel,
    searchQuery,
    ownedFirst,
    onCreateTokenClick,
    onCycleSortBy,
    onSearchQueryChange,
    onOwnedFirstChange,
    formatMarketCap,
  }: Props = $props();

  const walletConnected = $derived($walletStore.isConnected);

  const sortFilterToggles = $derived.by(() => [
    {
      id: "launch-owned-first-toggle",
      label: "Owned First",
      checked: ownedFirst,
      disabled: !walletConnected,
      onChange: onOwnedFirstChange,
    },
  ]);
</script>

<div class="list-view">
  <div class="page-header">
    <div class="page-heading">
      <h2>Launchpad</h2>
    </div>
    <ListPageToolbar
      sortByLabel={sortByLabel}
      sortGroupAriaLabel="Launch sorting settings"
      onCycleSortBy={onCycleSortBy}
      onPrimaryActionClick={onCreateTokenClick}
      primaryActionLabel="Create Token"
      search={{
        value: searchQuery,
        onValueChange: onSearchQueryChange,
        placeholder: "Search tokens",
        ariaLabel: "Search launched tokens by ticker",
      }}
      filterToggles={sortFilterToggles}
    />
  </div>

  <div class="token-list">
    {#each visibleLaunchTokens as token (token.account_id)}
      {@const iconSrc = getTokenIcon(token)}
      <div
        class="token-card"
        class:selected={selectedTokenId === token.account_id}
      >
        <a
          class="token-card-link-overlay"
          href={`/launch?token=${token.account_id}`}
          aria-label={`Open ${token.metadata.name}`}
        ></a>
        <div class="token-icon-shell">
          {#if iconSrc}
            <img
              src={iconSrc}
              alt={`${token.metadata.symbol} token`}
              class="token-icon-image"
            />
          {:else}
            <div class="token-icon-placeholder">
              {token.metadata.symbol.charAt(0) || "?"}
            </div>
          {/if}
        </div>
        <div class="token-content">
          <div class="name-and-symbol">
            <div class="name-row">
              <span class="token-name">{token.metadata.name}</span>
              <span class="token-mcap-inline">
                mcap {formatMarketCap(token)}
              </span>
            </div>
            <span class="token-symbol-row">{token.metadata.symbol}</span>
          </div>
          <div class="meta-row">
            <div class="token-right">
              <span class="mcap-mobile-label">mcap</span>
              <span class="mcap-mobile-value">
                {formatMarketCap(token)}
              </span>
            </div>
          </div>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .list-view {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .page-heading {
    display: flex;
    flex-direction: column;
  }

  .page-heading h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .token-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: 0.75rem;
  }

  .token-card {
    --token-card-height: 132px;
    --token-card-padding: 0.625rem;
    position: relative;
    display: flex;
    align-items: center;
    gap: 0.9rem;
    color: inherit;
    background: var(--bg-card);
    border: 1px solid var(--border-color);
    border-radius: 0.9rem;
    height: var(--token-card-height);
    padding: var(--token-card-padding);
    transition:
      border-color 0.2s ease,
      background 0.2s ease,
      box-shadow 0.2s ease;
    cursor: pointer;
    overflow: hidden;
  }

  .token-card-link-overlay {
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: inherit;
  }

  .token-card-link-overlay:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  .token-card:hover {
    border-color: var(--accent-primary);
    background: var(--bg-secondary);
    box-shadow: 0 8px 18px rgba(59, 130, 246, 0.14);
  }

  .token-card.selected {
    border-color: var(--accent-primary);
    box-shadow: inset 0 0 0 1px var(--accent-primary);
  }

  .token-icon-shell {
    width: calc(var(--token-card-height) - (var(--token-card-padding) * 2));
    height: calc(var(--token-card-height) - (var(--token-card-padding) * 2));
    border-radius: 0.7rem;
    overflow: hidden;
    flex-shrink: 0;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
  }

  .token-icon-image,
  .token-icon-placeholder {
    width: 100%;
    height: 100%;
    display: block;
  }

  .token-icon-image {
    object-fit: cover;
    object-position: center;
    transform-origin: center;
  }

  .token-icon-placeholder {
    background: linear-gradient(
      135deg,
      var(--accent-gradient-start),
      var(--accent-gradient-end)
    );
    color: var(--text-on-accent);
    font-size: 2rem;
    font-weight: 700;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .token-content {
    min-width: 0;
    flex: 1;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .name-and-symbol {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .name-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }

  .token-name {
    flex: 1;
    color: var(--text-primary);
    font-weight: 600;
    font-size: 1.05rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .token-symbol-row {
    color: var(--text-muted);
    font-size: 0.8rem;
    font-family: "JetBrains Mono", monospace;
    text-transform: uppercase;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .token-mcap-inline {
    color: var(--text-secondary);
    font-size: 0.84rem;
    font-family: "JetBrains Mono", monospace;
    margin-left: auto;
    text-align: right;
    width: max-content;
    white-space: nowrap;
    flex-shrink: 0;
    text-transform: uppercase;
  }

  .meta-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.8rem;
    min-width: 0;
  }

  .token-right {
    max-width: 160px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }

  .mcap-mobile-label,
  .mcap-mobile-value {
    display: none;
  }

  @media (max-width: 1024px) {
    .page-header {
      align-items: flex-start;
    }
  }

  @media (--mobile) {
    .token-list {
      grid-template-columns: 1fr;
    }

    .token-card {
      --token-card-height: 130px;
      --token-card-padding: 0.5rem;
      height: auto;
      min-height: 130px;
      align-items: stretch;
      position: relative;
      gap: 0;
    }

    .token-icon-shell {
      width: 64px;
      height: 64px;
      border-radius: 0.5rem;
      position: absolute;
      left: var(--token-card-padding);
      bottom: var(--token-card-padding);
    }

    .token-name {
      font-size: 0.95rem;
    }

    .token-content {
      height: auto;
      min-height: 64px;
      gap: 0.22rem;
    }

    .name-row {
      gap: 0.35rem;
    }

    .token-symbol-row {
      font-size: 0.75rem;
    }

    .meta-row {
      gap: 0.5rem;
      margin-left: calc(64px + 0.5rem);
      min-height: 64px;
    }

    .token-right {
      min-width: max-content;
      max-width: max-content;
      margin-left: auto;
    }

    .token-mcap-inline {
      display: none;
    }

    .mcap-mobile-label {
      display: block;
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    .mcap-mobile-value {
      display: block;
      color: var(--text-primary);
      font-weight: 600;
      font-family: "JetBrains Mono", monospace;
      font-size: 0.82rem;
      white-space: nowrap;
      text-align: right;
      width: max-content;
    }

  }
</style>
