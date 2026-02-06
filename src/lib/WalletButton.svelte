<script lang="ts">
  import { walletStore } from "./walletStore";

  let isConnecting = $state(false);

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
    <div class="account-badge">
      <div class="account-icon"></div>
      <span class="account-id">{$walletStore.accountId}</span>
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
      <span class="spinner"></span>
      Connecting...
    {:else}
      Connect Wallet
    {/if}
  </button>
{/if}

<style>
  .wallet-connected {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .account-badge {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.875rem;
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

  .connect-btn,
  .disconnect-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1.25rem;
    background: var(--accent-primary);
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
    padding: 0.5rem 0.875rem;
  }

  .disconnect-btn:hover {
    background: var(--bg-input);
    border-color: #ef4444;
    color: #ef4444;
  }

  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 640px) {
    .wallet-connected {
      gap: 0.5rem;
    }

    .account-badge {
      padding: 0.4rem 0.75rem;
    }

    .account-id {
      font-size: 0.8125rem;
      text-overflow: ellipsis;
    }

    .connect-btn,
    .disconnect-btn {
      padding: 0.5rem 1rem;
      font-size: 0.875rem;
    }

    .disconnect-btn {
      padding: 0.4rem 0.75rem;
    }
  }

  @media (max-width: 480px) {
    .wallet-connected {
      flex-wrap: wrap;
      gap: 0.5rem;
      width: 100%;
    }

    .account-badge {
      flex: 1;
      min-width: 0;
      padding: 0.4rem 0.625rem;
    }

    .account-id {
      font-size: 0.75rem;
      overflow: hidden;
    }

    .connect-btn {
      padding: 0.625rem 1rem;
      font-size: 0.875rem;
    }

    .disconnect-btn {
      padding: 0.4rem 0.625rem;
      gap: 0.375rem;
    }

    .disconnect-btn svg {
      width: 14px;
      height: 14px;
    }
  }

  @media (max-width: 360px) {
    .account-badge {
      padding: 0.375rem 0.5rem;
    }

    .account-id {
      font-size: 0.6875rem;
    }

    .disconnect-btn {
      padding: 0.375rem 0.5rem;
    }
  }
</style>
