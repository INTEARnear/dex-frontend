<script lang="ts">
  import TokenBadge from "./TokenBadge.svelte";
  import type { TokenInfo } from "./types";
  import { getTokenIcon } from "./utils";

  interface Props {
    token: TokenInfo | null;
    size?: number;
    showBadge?: boolean;
    badgeSmall?: boolean;
    overlap?: boolean;
    ring?: boolean;
    ringWidth?: number;
    className?: string;
  }

  let {
    token,
    size = 40,
    showBadge = false,
    badgeSmall = false,
    overlap = false,
    ring = false,
    ringWidth = 2,
    className = "",
  }: Props = $props();

  const symbol = $derived(token?.metadata.symbol ?? "?");
  const iconSrc = $derived.by(() => {
    if (!token) return null;
    return getTokenIcon(token);
  });
  const placeholderLetter = $derived(symbol.charAt(0) || "?");
</script>

{#if token}
  <div
    class={`token-icon-root ${overlap ? "overlap" : ""} ${ring ? "ring" : ""} ${className}`.trim()}
    style={`--token-icon-size: ${size}px; --token-icon-ring-width: ${ringWidth}px;`}
  >
    {#if iconSrc}
      <img src={iconSrc} alt={`${symbol} token`} class="token-icon-image" />
    {:else}
      <div class="token-icon-placeholder">{placeholderLetter}</div>
    {/if}
    {#if showBadge}
      <TokenBadge token={token} small={badgeSmall} />
    {/if}
  </div>
{/if}

<style>
  .token-icon-root {
    position: relative;
    width: var(--token-icon-size);
    height: var(--token-icon-size);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .token-icon-root.overlap {
    margin-left: calc(var(--token-icon-size) * -0.33);
  }

  .token-icon-image,
  .token-icon-placeholder {
    width: 100%;
    height: 100%;
    border-radius: 50%;
  }

  .token-icon-image {
    object-fit: cover;
    display: block;
  }

  .token-icon-placeholder {
    background: linear-gradient(135deg, var(--accent-primary), #2563eb);
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: 700;
    font-size: calc(var(--token-icon-size) * 0.4);
    line-height: 1;
  }

  .token-icon-root.ring .token-icon-image,
  .token-icon-root.ring .token-icon-placeholder {
    box-sizing: border-box;
    border: var(--token-icon-ring-width) solid var(--bg-card);
  }
</style>
