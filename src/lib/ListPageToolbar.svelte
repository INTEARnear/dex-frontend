<script lang="ts">
  import { ChevronDown, Plus } from "lucide-svelte";
  import { walletStore } from "$lib/walletStore";

  interface FilterToggleConfig {
    id: string;
    label: string;
    checked: boolean;
    disabled?: boolean;
    hidden?: boolean;
    onChange: (next: boolean) => void;
  }

  interface SearchConfig {
    value: string;
    onValueChange: (next: string) => void;
    placeholder: string;
    ariaLabel: string;
  }

  interface RefreshConfig {
    onClick: () => void;
    isRefreshing: boolean;
  }

  interface Props {
    sortByLabel: string;
    sortGroupAriaLabel: string;
    onCycleSortBy: () => void;
    onPrimaryActionClick: () => void;
    primaryActionLabel: string;
    search?: SearchConfig;
    filterToggles: FilterToggleConfig[];
    refresh?: RefreshConfig;
  }

  let {
    sortByLabel,
    sortGroupAriaLabel,
    onCycleSortBy,
    onPrimaryActionClick,
    primaryActionLabel,
    search,
    filterToggles,
    refresh,
  }: Props = $props();

  let isMobileSortOpen = $state(false);
  let isConnectingWallet = $state(false);

  const walletConnected = $derived($walletStore.isConnected);
  const visibleFilterToggles = $derived(
    filterToggles.filter((toggle) => !toggle.hidden),
  );

  function toggleMobileSort() {
    isMobileSortOpen = !isMobileSortOpen;
  }

  function closeMobileSort() {
    isMobileSortOpen = false;
  }

  function handlePrimaryActionClick() {
    closeMobileSort();
    onPrimaryActionClick();
  }

  async function handleConnectWallet() {
    closeMobileSort();
    isConnectingWallet = true;
    try {
      await walletStore.connect();
    } catch (error) {
      console.error("Connection failed:", error);
    } finally {
      isConnectingWallet = false;
    }
  }
</script>

<div class="header-actions" class:mobile-config-open={isMobileSortOpen}>
  {#if search !== undefined}
    <label class="search-control">
      <input
        type="search"
        class="search-input"
        value={search.value}
        placeholder={search.placeholder}
        aria-label={search.ariaLabel}
        spellcheck={false}
        autocapitalize="off"
        autocomplete="off"
        autocorrect="off"
        oninput={(event) => search.onValueChange(event.currentTarget.value)}
      />
    </label>
  {/if}

  <div class="sort-settings" role="group" aria-label={sortGroupAriaLabel}>
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

    {#each visibleFilterToggles as toggle (toggle.id)}
      <label
        class="filter-toggle"
        class:disabled={toggle.disabled}
        for={toggle.id}
      >
        <input
          id={toggle.id}
          type="checkbox"
          checked={toggle.checked}
          disabled={toggle.disabled}
          onchange={(event) =>
            toggle.onChange((event.currentTarget as HTMLInputElement).checked)}
        />
        <span>{toggle.label}</span>
      </label>
    {/each}
  </div>

  {#if walletConnected}
    <button
      type="button"
      class="primary-action-btn"
      onclick={handlePrimaryActionClick}
      aria-label={primaryActionLabel}
    >
      <Plus size={16} />
      <span>{primaryActionLabel}</span>
    </button>
  {:else}
    <button
      type="button"
      class="primary-action-btn"
      onclick={handleConnectWallet}
      disabled={isConnectingWallet}
      aria-label="Connect Wallet"
    >
      <span>{isConnectingWallet ? "Connecting..." : "Connect Wallet"}</span>
    </button>
  {/if}

  {#if refresh !== undefined}
    <button
      type="button"
      class="refresh-btn"
      onclick={() => refresh.onClick()}
      disabled={refresh.isRefreshing}
      aria-label="Refresh"
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
        class:spinning={refresh.isRefreshing}
      >
        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
        <path d="M16 21h5v-5" />
      </svg>
    </button>
  {/if}

  <div class="mobile-sort-controls">
    <div class="mobile-sort-row">
      <button
        type="button"
        class="mobile-sort-toggle"
        aria-expanded={isMobileSortOpen}
        onclick={toggleMobileSort}
      >
        <span>Sort By</span>
        <span class="mobile-sort-chevron" class:open={isMobileSortOpen}>
          <ChevronDown size={16} />
        </span>
      </button>

      {#if walletConnected}
        <button
          type="button"
          class="mobile-primary-action-btn"
          onclick={handlePrimaryActionClick}
          aria-label={primaryActionLabel}
          title={primaryActionLabel}
        >
          <Plus size={16} />
        </button>
      {:else}
        <button
          type="button"
          class="mobile-primary-action-btn"
          onclick={handleConnectWallet}
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

<style>
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

  .search-control {
    flex: 1 1 16rem;
    min-width: 12rem;
    max-width: 22rem;
  }

  .search-input {
    width: 100%;
    height: 2.25rem;
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    background: var(--bg-card);
    color: var(--text-primary);
    padding: 0 0.75rem;
    font-size: 0.9rem;
    transition:
      border-color 0.2s ease,
      box-shadow 0.2s ease,
      background 0.2s ease;
  }

  .search-input::placeholder {
    color: var(--text-muted);
  }

  .search-input:focus-visible {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 1px var(--accent-primary);
    background: var(--bg-input);
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

  .primary-action-btn {
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

  .primary-action-btn:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .primary-action-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  .primary-action-btn :global(svg) {
    flex-shrink: 0;
  }

  .refresh-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2.25rem;
    height: 2.25rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .refresh-btn:hover:not(:disabled) {
    background: var(--bg-tertiary);
    color: var(--text-primary);
    border-color: var(--accent-primary);
  }

  .refresh-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .refresh-btn svg.spinning {
    animation: spin 1s linear infinite;
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

  .mobile-primary-action-btn {
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

  .mobile-primary-action-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  @media (max-width: 1024px) {
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
    .primary-action-btn span {
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

    .search-control {
      width: 100%;
      max-width: none;
      min-width: 0;
      flex: 0 0 auto;
      order: 0;
      margin-bottom: 0.5rem;
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

    .primary-action-btn,
    .refresh-btn {
      display: none;
    }

    .mobile-sort-controls {
      display: block;
      order: 1;
      width: 100%;
    }
  }
</style>
