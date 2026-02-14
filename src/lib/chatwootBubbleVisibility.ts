type ChatwootApi = {
  toggleBubbleVisibility?: (state: "hide" | "show") => void;
};

let visibleModalCount = 0;

function getChatwootApi(): ChatwootApi | null {
  return (window as Window & { $chatwoot?: ChatwootApi }).$chatwoot ?? null;
}

function syncBubbleVisibility() {
  const api = getChatwootApi();
  if (!api?.toggleBubbleVisibility) {
    return;
  }

  api.toggleBubbleVisibility(visibleModalCount > 0 ? "hide" : "show");
}

export function createChatwootModalVisibilityController() {
  let isVisible = false;

  function setVisible(nextVisible: boolean) {
    if (nextVisible === isVisible) {
      return;
    }

    isVisible = nextVisible;
    visibleModalCount += nextVisible ? 1 : -1;
    if (visibleModalCount < 0) {
      visibleModalCount = 0;
    }

    syncBubbleVisibility();
  }

  function dispose() {
    setVisible(false);
  }

  return { setVisible, dispose };
}
