type ChatwootApi = {
  toggleBubbleVisibility?: (state: "hide" | "show") => void;
};

let visibleModalCount = 0;
const SUPPORT_BUTTON_ID = "support-chat-button";

function setSupportButtonVisibility(isVisible: boolean) {
  const supportButton = document.getElementById(SUPPORT_BUTTON_ID);
  if (!supportButton) {
    return;
  }

  if (isVisible) {
    supportButton.removeAttribute("hidden");
  } else {
    supportButton.setAttribute("hidden", "hidden");
  }
}

function getChatwootApi(): ChatwootApi | null {
  return (window as Window & { $chatwoot?: ChatwootApi }).$chatwoot ?? null;
}

function syncBubbleVisibility() {
  setSupportButtonVisibility(visibleModalCount === 0);

  const api = getChatwootApi();
  if (!api?.toggleBubbleVisibility) {
    return;
  }

  api.toggleBubbleVisibility("hide");
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
