<script lang="ts">
  import { onDestroy, onMount } from "svelte";

  interface Props {
    twitchUrl: string | null;
    tokenSymbol: string;
  }

  type TwitchLiveState = "offline" | "checking" | "live";

  interface TwitchPlayerOptions {
    width: number | string;
    height: number | string;
    channel: string;
    parent: string[];
    autoplay: boolean;
    muted: boolean;
  }

  interface TwitchPlayerApi {
    addEventListener(eventName: string, callback: () => void): void;
    getEnded(): boolean;
    play(): void;
    setMuted(muted: boolean): void;
    destroy?: () => void;
  }

  interface TwitchPlayerConstructor {
    new (elementId: string, options: TwitchPlayerOptions): TwitchPlayerApi;
    READY: string;
    ONLINE: string;
    OFFLINE: string;
    ENDED: string;
    PLAY: string;
    PLAYING: string;
  }

  interface TwitchWindow extends Window {
    Twitch?: {
      Player: TwitchPlayerConstructor;
    };
  }

  const TWITCH_PLAYER_CONTAINER_ID = "launch-twitch-player";
  const INITIAL_STATE_PROBE_DELAY_MS = 1_500;

  let { twitchUrl, tokenSymbol }: Props = $props();

  let twitchParentHost = $state<string | null>(null);
  let playerContainerElement = $state<HTMLDivElement | null>(null);
  let liveState = $state<TwitchLiveState>("offline");
  let currentChannelKey = $state<string | null>(null);
  let lastPreparedChannelKey = $state<string | null>(null);
  let activeInitializationId = 0;
  let twitchPlayerInstance: TwitchPlayerApi | null = null;

  const twitchChannelHandle = $derived.by(() => parseTwitchChannelHandle(twitchUrl));
  const twitchChannelKey = $derived.by(() => {
    if (!twitchChannelHandle || !twitchParentHost) return null;
    return `${twitchChannelHandle}@${twitchParentHost}`;
  });
  const twitchChatEmbedSrc = $derived.by(() => {
    if (!twitchChannelHandle || !twitchParentHost) return null;
    return `https://www.twitch.tv/embed/${encodeURIComponent(twitchChannelHandle)}/chat?parent=${encodeURIComponent(twitchParentHost)}`;
  });

  function parseTwitchChannelHandle(url: string | null): string | null {
    if (!url) return null;

    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.protocol !== "https:") return null;
      if (parsedUrl.hostname !== "twitch.tv" && parsedUrl.hostname !== "www.twitch.tv") {
        return null;
      }

      const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
      if (pathSegments.length !== 1) return null;

      return pathSegments[0];
    } catch {
      return null;
    }
  }

  function getTwitchPlayerConstructor(): TwitchPlayerConstructor | null {
    return (window as TwitchWindow).Twitch?.Player ?? null;
  }

  async function waitForTwitchPlayerConstructor(): Promise<TwitchPlayerConstructor> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 5_000) {
      const playerConstructor = getTwitchPlayerConstructor();
      if (playerConstructor) return playerConstructor;

      await new Promise((resolve) => {
        window.setTimeout(resolve, 50);
      });
    }

    throw new Error("Timed out while loading the Twitch player SDK");
  }

  async function loadTwitchPlayerScript(): Promise<TwitchPlayerConstructor> {
    const existingPlayerConstructor = getTwitchPlayerConstructor();
    if (existingPlayerConstructor) return existingPlayerConstructor;

    const existingScript = document.querySelector<HTMLScriptElement>(
      'script[data-twitch-player-sdk="true"]',
    );
    if (!existingScript) {
      const script = document.createElement("script");
      script.src = "https://player.twitch.tv/js/embed/v1.js";
      script.async = true;
      script.dataset.twitchPlayerSdk = "true";
      document.head.append(script);
    }

    return waitForTwitchPlayerConstructor();
  }

  function cleanupPlayer(): void {
    activeInitializationId += 1;
    twitchPlayerInstance?.destroy?.();
    twitchPlayerInstance = null;

    if (playerContainerElement) {
      playerContainerElement.innerHTML = "";
    }
  }

  function markChannelLive(channelKey: string): void {
    if (currentChannelKey !== channelKey) return;
    liveState = "live";

    window.requestAnimationFrame(() => {
      if (currentChannelKey !== channelKey || liveState !== "live") return;

      try {
        twitchPlayerInstance?.setMuted(true);
        twitchPlayerInstance?.play();
      } catch {
        // The embed can refuse autoplay on some browsers; keep the section visible anyway.
      }
    });
  }

  function markChannelOffline(channelKey: string): void {
    if (currentChannelKey !== channelKey) return;
    cleanupPlayer();
    currentChannelKey = null;
    liveState = "offline";
  }

  async function initializePlayer(
    channelHandle: string,
    parentHost: string,
    channelKey: string,
  ): Promise<void> {
    const initializationId = activeInitializationId;

    try {
      const TwitchPlayer = await loadTwitchPlayerScript();
      if (
        initializationId !== activeInitializationId ||
        currentChannelKey !== channelKey ||
        !playerContainerElement
      ) {
        return;
      }

      playerContainerElement.innerHTML = "";
      const player = new TwitchPlayer(TWITCH_PLAYER_CONTAINER_ID, {
        width: "100%",
        height: "100%",
        channel: channelHandle,
        parent: [parentHost],
        autoplay: true,
        muted: true,
      });
      twitchPlayerInstance = player;

      const handleLive = () => {
        markChannelLive(channelKey);
      };
      const handleOffline = () => {
        markChannelOffline(channelKey);
      };

      player.addEventListener(TwitchPlayer.ONLINE, handleLive);
      player.addEventListener(TwitchPlayer.PLAY, handleLive);
      player.addEventListener(TwitchPlayer.PLAYING, handleLive);
      player.addEventListener(TwitchPlayer.OFFLINE, handleOffline);
      player.addEventListener(TwitchPlayer.ENDED, handleOffline);
      player.addEventListener(TwitchPlayer.READY, () => {
        if (currentChannelKey !== channelKey) return;

        player.setMuted(true);
        player.play();

        window.setTimeout(() => {
          if (currentChannelKey !== channelKey || liveState !== "checking") return;

          try {
            if (player.getEnded()) {
              handleOffline();
            } else {
              handleLive();
            }
          } catch {
            handleOffline();
          }
        }, INITIAL_STATE_PROBE_DELAY_MS);
      });
    } catch (error) {
      console.error("Failed to initialize Twitch player:", error);

      if (currentChannelKey === channelKey) {
        cleanupPlayer();
        currentChannelKey = null;
        liveState = "offline";
      }
    }
  }

  onMount(() => {
    twitchParentHost = window.location.hostname;
  });

  onDestroy(() => {
    cleanupPlayer();
    currentChannelKey = null;
  });

  $effect(() => {
    const nextChannelKey = twitchChannelKey;
    if (nextChannelKey === lastPreparedChannelKey) return;

    lastPreparedChannelKey = nextChannelKey;
    cleanupPlayer();
    currentChannelKey = null;
    liveState = nextChannelKey === null ? "offline" : "checking";
  });

  $effect(() => {
    const channelHandle = twitchChannelHandle;
    const parentHost = twitchParentHost;
    const channelKey = twitchChannelKey;
    const playerHost = playerContainerElement;

    if (!channelHandle || !parentHost || !channelKey || !playerHost) return;
    if (liveState === "offline") return;
    if (currentChannelKey === channelKey) return;

    currentChannelKey = channelKey;
    void initializePlayer(channelHandle, parentHost, channelKey);
  });
</script>

{#if twitchChannelHandle !== null && twitchParentHost !== null && liveState !== "offline"}
  <section class="twitch-section" class:probing={liveState === "checking"}>
    {#if liveState === "live"}
      <div class="twitch-section-header">
        <h3>Twitch</h3>
        <a
          href={twitchUrl ?? `https://twitch.tv/${twitchChannelHandle}`}
          target="_blank"
          rel="noopener noreferrer"
          class="twitch-channel-link"
        >
          twitch.tv/{twitchChannelHandle}
        </a>
      </div>
    {/if}

    <div class="twitch-grid" class:live={liveState === "live"}>
      <div class="twitch-player-card">
        <div
          id={TWITCH_PLAYER_CONTAINER_ID}
          bind:this={playerContainerElement}
          class="twitch-player-host"
        ></div>
      </div>

      {#if liveState === "live" && twitchChatEmbedSrc}
        <div class="twitch-chat-card">
          <iframe
            src={twitchChatEmbedSrc}
            title={`${tokenSymbol} Twitch chat`}
            class="twitch-chat-frame"
            loading="lazy"
            sandbox="allow-storage-access-by-user-activation allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-modals"
          ></iframe>
        </div>
      {/if}
    </div>
  </section>
{/if}

<style>
  .twitch-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .twitch-section.probing {
    position: fixed;
    left: -10000px;
    top: 0;
    width: 854px;
    opacity: 0;
    pointer-events: none;
    overflow: hidden;
  }

  .twitch-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .twitch-section-header h3 {
    margin: 0;
    color: var(--text-primary);
    font-size: 1rem;
  }

  .twitch-channel-link {
    color: var(--text-secondary);
    font-size: 0.78rem;
    font-family: "JetBrains Mono", monospace;
    text-decoration: none;
    word-break: break-all;
  }

  .twitch-channel-link:hover {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .twitch-grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.75rem;
    align-items: stretch;
  }

  .twitch-grid.live {
    grid-template-columns: minmax(0, 1fr) minmax(320px, 360px);
  }

  .twitch-player-card,
  .twitch-chat-card {
    overflow: hidden;
    border: 1.2px solid var(--border-color);
    border-radius: 1rem;
    background: var(--bg-card);
  }

  .twitch-player-card {
    position: relative;
    min-height: 360px;
  }

  .twitch-player-host {
    width: 100%;
    height: 100%;
    min-height: 360px;
    background: var(--bg-secondary);
  }

  .twitch-chat-card {
    min-height: 360px;
  }

  .twitch-chat-frame {
    width: 100%;
    height: 100%;
    min-height: 360px;
    border: 0;
    display: block;
  }

  @media (max-width: 960px) {
    .twitch-grid.live {
      grid-template-columns: 1fr;
    }
  }

  @media (--mobile) {
    .twitch-player-card,
    .twitch-chat-card,
    .twitch-player-host,
    .twitch-chat-frame {
      min-height: 320px;
    }
  }
</style>
