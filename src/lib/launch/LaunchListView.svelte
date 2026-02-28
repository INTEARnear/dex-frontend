<script lang="ts">
  import { ChevronDown, Globe, Plus } from "lucide-svelte";
  import { siTelegram, siX } from "simple-icons";
  import type { TokenInfo } from "$lib/types";
  import { getTokenIcon } from "$lib/utils";
  import type { LaunchToken } from "./types";

  interface Props {
    visibleLaunchTokens: LaunchToken[];
    selectedTokenId: string | null;
    sortByLabel: string;
    isMobileSortOpen: boolean;
    ownedFirst: boolean;
    walletConnected: boolean;
    isConnectingWallet: boolean;
    onCreateTokenClick: () => void;
    onConnectWalletClick: () => void;
    onCycleSortBy: () => void;
    onToggleMobileSort: () => void;
    onOwnedFirstChange: (next: boolean) => void;
    formatMarketCap: (token: TokenInfo) => string;
  }

  let {
    visibleLaunchTokens,
    selectedTokenId,
    sortByLabel,
    isMobileSortOpen,
    ownedFirst,
    walletConnected,
    isConnectingWallet,
    onCreateTokenClick,
    onConnectWalletClick,
    onCycleSortBy,
    onToggleMobileSort,
    onOwnedFirstChange,
    formatMarketCap,
  }: Props = $props();

  function hasAnySocialLinks(data: LaunchToken["launchData"]): boolean {
    return Boolean(data.x || data.telegram || data.website);
  }
</script>

<div class="list-view">
  <div class="page-header">
    <div class="page-heading">
      <h2>Launchpad</h2>
      <p>Anyone can launch their token here. DYOR before buying.</p>
    </div>
    <div class="header-actions" class:mobile-config-open={isMobileSortOpen}>
      <div
        class="sort-settings"
        role="group"
        aria-label="Launch sorting settings"
      >
        <div class="sort-by-control">
          <span class="sort-by-label">Sort by</span>
          <button
            type="button"
            class="sort-cycle-btn"
            onclick={onCycleSortBy}
            aria-label={`Sort by ${sortByLabel}. Activate to cycle sort mode.`}
          >
            {sortByLabel}
          </button>
        </div>
        <label
          class="filter-toggle"
          class:disabled={!walletConnected}
          for="launch-owned-first-toggle"
        >
          <input
            id="launch-owned-first-toggle"
            type="checkbox"
            checked={ownedFirst}
            disabled={!walletConnected}
            onchange={(event) =>
              onOwnedFirstChange(
                (event.currentTarget as HTMLInputElement).checked,
              )}
          />
          <span>Owned First</span>
        </label>
      </div>
      {#if walletConnected}
        <button
          type="button"
          class="create-token-btn"
          onclick={onCreateTokenClick}
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
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
          <span>Create Token</span>
        </button>
      {:else}
        <button
          type="button"
          class="create-token-btn"
          onclick={onConnectWalletClick}
          disabled={isConnectingWallet}
        >
          <span>{isConnectingWallet ? "Connecting..." : "Connect Wallet"}</span>
        </button>
      {/if}

      <div class="mobile-sort-controls">
        <div class="mobile-sort-row">
          <button
            type="button"
            class="mobile-sort-toggle"
            aria-expanded={isMobileSortOpen}
            onclick={onToggleMobileSort}
          >
            <span>Sort By</span>
            <span class="mobile-sort-chevron" class:open={isMobileSortOpen}>
              <ChevronDown size={16} />
            </span>
          </button>
          {#if walletConnected}
            <button
              type="button"
              class="mobile-create-token-btn"
              onclick={onCreateTokenClick}
              aria-label="Create Token"
              title="Create Token"
            >
              <Plus size={16} />
            </button>
          {:else}
            <button
              type="button"
              class="mobile-create-token-btn"
              onclick={onConnectWalletClick}
              disabled={isConnectingWallet}
              aria-label="Connect Wallet"
              title={isConnectingWallet ? "Connecting..." : "Connect Wallet"}
            >
              <Plus size={16} />
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <div class="token-list">
    {#each visibleLaunchTokens as launchToken (launchToken.token.account_id)}
      {@const iconSrc = getTokenIcon(launchToken.token)}
      <div
        class="token-card"
        class:selected={selectedTokenId === launchToken.token.account_id}
      >
        <a
          class="token-card-link-overlay"
          href={`/launch?token=${launchToken.token.account_id}`}
          aria-label={`Open ${launchToken.token.metadata.name}`}
        ></a>
        <div class="token-icon-shell">
          {#if iconSrc}
            <img
              src={iconSrc}
              alt={`${launchToken.token.metadata.symbol} token`}
              class="token-icon-image"
            />
          {:else}
            <div class="token-icon-placeholder">
              {launchToken.token.metadata.symbol.charAt(0) || "?"}
            </div>
          {/if}
        </div>
        <div class="token-content">
          <div class="name-and-symbol">
            <div class="name-row">
              <span class="token-name">{launchToken.token.metadata.name}</span>
              <span class="token-mcap-inline">
                mcap {formatMarketCap(launchToken.token)}
              </span>
              <a
                href={`https://nearblocks.io/address/${launchToken.launchData.launched_by}`}
                target="_blank"
                rel="noopener noreferrer"
                class="launched-by-inline"
                title={launchToken.launchData.launched_by}
              >
                {launchToken.launchData.launched_by}
              </a>
            </div>
            <span class="token-symbol-row"
              >{launchToken.token.metadata.symbol}</span
            >
          </div>
          <div class="meta-row">
            <p class="token-description">
              {launchToken.launchData.description}
            </p>
            <div class="token-right">
              <div class="launched-by-row">
                <span class="launched-by-label">by</span>
                <a
                  href={`https://nearblocks.io/address/${launchToken.launchData.launched_by}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="launched-by-btn"
                  title={launchToken.launchData.launched_by}
                >
                  {launchToken.launchData.launched_by}
                </a>
              </div>
              <span class="mcap-mobile-label">mcap</span>
              <span class="mcap-mobile-value">
                {formatMarketCap(launchToken.token)}
              </span>
              {#if hasAnySocialLinks(launchToken.launchData)}
                <div class="token-links">
                  {#if launchToken.launchData.x !== null}
                    <a
                      href={launchToken.launchData.x}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="token-link-btn"
                      aria-label="Token X"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        role="img"
                      >
                        <path d={siX.path} />
                      </svg>
                    </a>
                  {/if}
                  {#if launchToken.launchData.telegram !== null}
                    <a
                      href={launchToken.launchData.telegram}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="token-link-btn"
                      aria-label="Token Telegram"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        role="img"
                      >
                        <path d={siTelegram.path} />
                      </svg>
                    </a>
                  {/if}
                  {#if launchToken.launchData.website !== null}
                    <a
                      href={launchToken.launchData.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="token-link-btn"
                      aria-label="Token Website"
                    >
                      <Globe size={14} />
                    </a>
                  {/if}
                </div>
              {/if}
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

  .page-heading p {
    margin: 0.4rem 0 0;
    color: var(--text-secondary);
    font-size: 0.9rem;
  }

  .header-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .sort-settings {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    padding: 0.45rem 0.65rem;
  }

  .sort-by-control {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .sort-by-label {
    font-size: 0.9rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .sort-cycle-btn {
    width: 7rem;
    min-width: 7rem;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: 0.4rem;
    background: var(--bg-card);
    color: var(--text-primary);
    font-size: 0.9rem;
    font-weight: 500;
    margin-left: 0.25rem;
    cursor: pointer;
    text-align: center;
    transition:
      background 0.2s ease,
      border-color 0.2s ease,
      filter 0.2s ease;
  }

  .sort-cycle-btn:hover {
    border-color: var(--border-color);
    filter: brightness(1.25);
  }

  .sort-cycle-btn:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 1px;
  }

  .filter-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    color: var(--text-secondary);
    font-size: 0.9rem;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
  }

  .filter-toggle.disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .filter-toggle input {
    margin: 0;
    accent-color: var(--accent-primary);
  }

  .create-token-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.52rem 1rem;
    background: var(--accent-button-small);
    border: none;
    border-radius: 0.5rem;
    color: var(--text-on-accent);
    font-weight: 600;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .create-token-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .create-token-btn svg {
    flex-shrink: 0;
  }

  .mobile-sort-controls {
    display: none;
    width: 100%;
  }

  .mobile-sort-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.45rem;
    width: 100%;
  }

  .mobile-sort-toggle {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: 0.4rem;
    padding: 0.45rem 0;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--text-primary);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
  }

  .mobile-sort-chevron {
    color: var(--text-secondary);
    transition: transform 0.2s ease;
  }

  .mobile-sort-chevron.open {
    transform: rotate(180deg);
  }

  .mobile-create-token-btn {
    width: 2.25rem;
    height: 2.25rem;
    border: none;
    border-radius: 0.5rem;
    background: var(--accent-button-small);
    color: var(--text-on-accent);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }

  .mobile-create-token-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
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

  .launched-by-inline {
    display: none;
    max-width: 45%;
    color: var(--text-primary);
    text-decoration: none;
    font-weight: 500;
    font-family: "JetBrains Mono", monospace;
    font-size: 0.74rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0;
    position: relative;
    z-index: 2;
  }

  .launched-by-inline:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .meta-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.8rem;
    min-width: 0;
  }

  .token-description {
    margin: 0;
    color: var(--text-secondary);
    font-size: 0.86rem;
    line-height: 1.35;
    flex: 1;
    min-width: 0;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    line-clamp: 3;
    overflow: hidden;
  }

  .token-right {
    max-width: 160px;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }

  .launched-by-row {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 0.25rem;
    min-width: 0;
    width: 100%;
    justify-content: flex-end;
  }

  .launched-by-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    flex-shrink: 0;
  }

  .launched-by-btn {
    min-width: 0;
    padding: 0.2rem 0.42rem;
    color: var(--text-primary);
    text-decoration: none;
    font-weight: 500;
    font-family: "JetBrains Mono", monospace;
    font-size: 0.78rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    position: relative;
    z-index: 2;
  }

  .launched-by-btn:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .mcap-mobile-label,
  .mcap-mobile-value {
    display: none;
  }

  .token-links {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 0.35rem;
    margin-top: 0.35rem;
    flex-shrink: 0;
  }

  .token-link-btn {
    text-decoration: none;
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    border-radius: 0.45rem;
    width: 1.55rem;
    height: 1.55rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    position: relative;
    z-index: 2;
    transition:
      border-color 0.2s ease,
      color 0.2s ease,
      background 0.2s ease;
  }

  .token-link-btn:hover {
    border-color: var(--accent-primary);
    color: var(--text-primary);
    background: var(--bg-input);
  }

  @media (max-width: 1024px) {
    .page-header {
      align-items: flex-start;
    }

    .header-actions {
      width: 100%;
      justify-content: flex-start;
    }
  }

  @media (max-width: 460px) {
    .sort-settings {
      width: 100%;
      flex-direction: column;
      align-items: stretch;
      gap: 0.5rem;
    }

    .sort-by-control {
      justify-content: space-between;
    }

    .sort-cycle-btn {
      min-width: 0;
      width: 7rem;
    }
  }

  @media (max-width: 400px) {
    .create-token-btn span {
      display: none;
    }
  }

  @media (max-width: 360px) {
    .sort-by-control {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.25rem;
    }

    .sort-cycle-btn {
      margin-left: 0;
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

    .token-description {
      font-size: 0.8rem;
      -webkit-line-clamp: 2;
      line-clamp: 2;
    }

    .token-right {
      min-width: max-content;
      max-width: max-content;
      margin-left: auto;
    }

    .token-mcap-inline {
      display: none;
    }

    .launched-by-inline {
      display: inline-block;
    }

    .launched-by-row {
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

    .token-links {
      gap: 0.3rem;
      margin-top: 0.2rem;
    }

    .header-actions {
      width: 100%;
      flex-direction: column;
      align-items: stretch;
      gap: 0.35rem;
    }

    .sort-settings {
      display: none;
      order: 2;
      width: 100%;
      padding: 0;
      gap: 0.55rem;
      background: transparent;
    }

    .header-actions.mobile-config-open .sort-settings {
      display: flex;
      align-items: stretch;
      flex-wrap: wrap;
      width: 100%;
      flex-direction: column;
    }

    .header-actions.mobile-config-open .sort-by-control {
      width: 100%;
      justify-content: space-between;
    }

    .header-actions.mobile-config-open .sort-cycle-btn {
      width: 100%;
      min-width: 0;
      margin-left: 0;
    }

    .header-actions.mobile-config-open .filter-toggle {
      width: auto;
      justify-content: flex-start;
      align-self: flex-start;
    }

    .create-token-btn {
      display: none;
    }

    .mobile-sort-controls {
      display: block;
      order: 1;
      width: 100%;
    }
  }
</style>
