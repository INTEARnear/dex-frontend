<script lang="ts">
  import { tokenHubStore } from "./tokenHubStore";
  import type { TokenInfo } from "./types";

  interface Props {
    token: TokenInfo;
    small?: boolean;
  }

  let { token, small = false }: Props = $props();

  // Character substitution map for detecting similar symbols
  const SIMILAR_LOOKING_CHARS: Record<string, string[]> = {
    O: ["0"],
    l: ["1", ""],
  };

  function normalizeSymbol(symbol: string): string {
    let normalized = symbol.toUpperCase();
    for (const [char, substitutes] of Object.entries(SIMILAR_LOOKING_CHARS)) {
      for (const substitute of substitutes) {
        normalized = normalized.replaceAll(substitute, char);
      }
    }
    return normalized.toUpperCase();
  }

  function isSymbolSimilar(symbol1: string, symbol2: string): boolean {
    return normalizeSymbol(symbol1) === normalizeSymbol(symbol2);
  }

  const isSuspicious = $derived.by(() => {
    if (token.reputation === "Reputable" || token.reputation === "NotFake") {
      return false;
    }

    const symbol = token.metadata.symbol;

    // Filter out unknown characters
    if (/[^a-zA-Z0-9._\-$%@ ]/.test(symbol)) {
      return true;
    }

    // 2+ consecutive spaces
    if (/\s{2,}/.test(symbol)) {
      return true;
    }

    const reputableTokens = $tokenHubStore.tokens.filter(
      (t) => t.reputation === "Reputable" || t.reputation === "NotFake",
    );

    for (const reputableToken of reputableTokens) {
      const reputableSymbol = reputableToken.metadata.symbol;

      if (
        isSymbolSimilar(symbol.toUpperCase(), reputableSymbol.toUpperCase())
      ) {
        return true;
      }
    }

    return false;
  });
</script>

{#if isSuspicious}
  <div
    class="reputation-badge reputation-warning"
    class:reputation-badge-small={small}
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path
        d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
      />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  </div>
{:else if token.reputation === "Reputable"}
  <div
    class="reputation-badge reputation-reputable"
    class:reputation-badge-small={small}
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  </div>
{:else if token.reputation === "NotFake"}
  <div
    class="reputation-badge reputation-notfake"
    class:reputation-badge-small={small}
  >
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  </div>
{/if}

<style>
  .reputation-badge {
    position: absolute;
    bottom: -3px;
    left: -3px;
    width: 1.25rem;
    height: 1.25rem;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid var(--bg-card);
  }

  .reputation-badge svg {
    width: 0.65rem;
    height: 0.65rem;
    stroke: white;
  }

  .reputation-badge-small {
    bottom: -2px;
    left: -2px;
    width: 0.9rem;
    height: 0.9rem;
    border-width: 1.5px;
    border-color: var(--bg-input);
  }

  .reputation-badge-small svg {
    width: 0.5rem;
    height: 0.5rem;
  }

  .reputation-reputable {
    background: #15803d;
  }

  .reputation-notfake {
    background: #3b82f6;
  }

  .reputation-warning {
    background: #dc2626;
  }

  .reputation-warning svg {
    width: 0.7rem;
    height: 0.7rem;
  }

  .reputation-badge-small.reputation-warning svg {
    width: 0.55rem;
    height: 0.55rem;
  }
</style>
