(() => {
  "use strict";

  const validStates = new Set(["default", "detail", "search"]);
  const appWindow = document.querySelector("[data-app-window]");
  const libraryContent = document.querySelector("[data-library-view]");
  const libraryChrome = document.querySelector("[data-library-chrome]");
  const detailPage = document.querySelector("[data-detail-page]");
  const detailReturnContext = document.querySelector("[data-detail-return-context]");
  const searchForm = document.querySelector("#search-form");
  const searchInput = document.querySelector("#search-input");
  const queryLabels = document.querySelectorAll("[data-query-label]");
  const stateButtons = document.querySelectorAll("[data-state-target]");
  const stateVisibleItems = document.querySelectorAll("[data-state-visible]");
  const detailTitle = document.querySelector("[data-detail-title]");
  const detailMeta = document.querySelector("[data-detail-meta]");
  let lastNonDetailState = "default";
  let savedSearchQuery = "";
  let savedScrollTop = 0;
  const filterSummary = "全部类型 / 观看状态 / 最近添加";

  function readState() {
    const query = new URLSearchParams(window.location.search).get("state");
    return validStates.has(query) ? query : "default";
  }

  function loadUrlContext(state) {
    const params = new URLSearchParams(window.location.search);

    if (state === "detail") {
      const from = params.get("from");
      lastNonDetailState = from === "search" ? "search" : "default";
      savedSearchQuery = params.get("query") || "";
      savedScrollTop = Number.parseInt(params.get("scroll") || "0", 10) || 0;
      searchInput.value = savedSearchQuery;
    } else if (state === "search") {
      searchInput.value = params.get("query") || "星际";
    }
  }

  function writeStateToUrl(state) {
    const url = new URL(window.location.href);
    url.searchParams.set("state", state);

    if (state === "detail") {
      url.searchParams.set("from", lastNonDetailState);
      url.searchParams.set("scroll", String(Math.round(savedScrollTop)));
      if (savedSearchQuery) {
        url.searchParams.set("query", savedSearchQuery);
      } else {
        url.searchParams.delete("query");
      }
    } else if (state === "search") {
      url.searchParams.set("query", searchInput.value.trim() || "星际");
      url.searchParams.delete("from");
      url.searchParams.delete("scroll");
    } else {
      url.searchParams.delete("query");
      url.searchParams.delete("from");
      url.searchParams.delete("scroll");
    }

    try {
      window.history.replaceState({ state }, "", url);
    } catch (error) {
      // Some local file handlers do not allow history updates. The UI state still works.
    }
  }

  function setVisibleByState(state) {
    stateVisibleItems.forEach((item) => {
      const allowedStates = item.dataset.stateVisible.split(/\s+/);
      item.hidden = !allowedStates.includes(state);
    });
  }

  function updateReturnContext() {
    const queryLabel = savedSearchQuery ? `搜索词“${savedSearchQuery}”` : "无搜索词";
    detailReturnContext.textContent = `返回片库将恢复：${queryLabel} · 筛选：${filterSummary} · 网格位置 ${Math.round(savedScrollTop)}px`;
  }

  function setState(state, { updateUrl = true, fromUrl = false } = {}) {
    if (!validStates.has(state)) {
      state = "default";
    }

    const previousState = appWindow.dataset.state || "default";

    if (state === "detail" && previousState !== "detail") {
      if (!fromUrl) {
        lastNonDetailState = previousState;
        savedSearchQuery = searchInput.value.trim();
        savedScrollTop = libraryContent.scrollTop;
      }
      updateReturnContext();
    } else if (state !== "detail" && previousState !== "detail") {
      lastNonDetailState = state;
    }

    appWindow.dataset.state = state;
    document.body.dataset.state = state;
    libraryChrome.hidden = state === "detail";
    libraryContent.hidden = state === "detail";
    detailPage.hidden = state !== "detail";
    setVisibleByState(state);

    stateButtons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.stateTarget === state));
    });

    if (state === "search") {
      if (!searchInput.value.trim()) {
        searchInput.value = "星际";
      }
      queryLabels.forEach((label) => {
        label.textContent = searchInput.value.trim() || "星际";
      });
      if (previousState === "detail") {
        searchInput.value = savedSearchQuery || searchInput.value;
        libraryContent.scrollTop = savedScrollTop;
      }
    } else if (state === "default") {
      searchInput.value = "";
      if (previousState === "detail") {
        libraryContent.scrollTop = savedScrollTop;
      }
    } else if (state === "detail") {
      searchInput.value = savedSearchQuery;
    }

    if (updateUrl) {
      writeStateToUrl(state);
    }
  }

  stateButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setState(button.dataset.stateTarget);
    });
  });

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    searchInput.value = searchInput.value.trim() || "星际";
    if (appWindow.dataset.state === "detail") {
      savedSearchQuery = searchInput.value;
      lastNonDetailState = "search";
    }
    setState("search");
  });

  document.querySelectorAll("[data-open-detail]").forEach((card) => {
    card.addEventListener("click", () => {
      const title = card.querySelector(".card-title")?.textContent?.trim();
      const meta = card.querySelector(".card-meta")?.textContent?.trim();
      if (title) {
        detailTitle.textContent = title;
      }
      if (meta) {
        detailMeta.textContent = meta;
      }
      setState("detail");
    });
  });

  document.querySelectorAll("[data-close-detail], [data-back-library]").forEach((button) => {
    button.addEventListener("click", () => {
      setState(lastNonDetailState || "default");
    });
  });

  document.querySelectorAll("[data-clear-search]").forEach((button) => {
    button.addEventListener("click", () => {
      searchInput.value = "";
      setState("default");
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && appWindow.dataset.state === "detail") {
      setState(lastNonDetailState || "default");
    }
  });

  window.addEventListener("popstate", () => {
    const state = readState();
    loadUrlContext(state);
    setState(state, { updateUrl: false, fromUrl: true });
  });

  const initialState = readState();
  loadUrlContext(initialState);
  setState(initialState, { updateUrl: false, fromUrl: true });
})();
