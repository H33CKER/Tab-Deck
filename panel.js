(function startGXTabDeck() {
  "use strict";

  const State = globalThis.GXTabState;
  const Resources = globalThis.GXTabResources;
  const Interactions = globalThis.GXTabInteractions;
  const SUPPORT_URL = "https://ko-fi.com/h33cker";
  const isExtension = Boolean(
    globalThis.chrome &&
    chrome.runtime &&
    chrome.runtime.id &&
    chrome.tabs &&
    chrome.windows
  );
  const faviconEndpoint = isExtension ? chrome.runtime.getURL("/_favicon/") : "";

  const elements = {
    appShell: document.getElementById("appShell"),
    createIslandButton: document.getElementById("createIslandButton"),
    settingsButton: document.getElementById("settingsButton"),
    closeSettingsButton: document.getElementById("closeSettingsButton"),
    settingsDrawer: document.getElementById("settingsDrawer"),
    drawerScrim: document.getElementById("drawerScrim"),
    tabSearch: document.getElementById("tabSearch"),
    clearSearchButton: document.getElementById("clearSearchButton"),
    searchShortcut: document.getElementById("searchShortcut"),
    tabTotal: document.getElementById("tabTotal"),
    tabsViewport: document.getElementById("tabsViewport"),
    loadingState: document.getElementById("loadingState"),
    tabTree: document.getElementById("tabTree"),
    emptyState: document.getElementById("emptyState"),
    emptyStateTitle: document.getElementById("emptyStateTitle"),
    emptyStateText: document.getElementById("emptyStateText"),
    newTabButton: document.getElementById("newTabButton"),
    newTabShortcut: document.getElementById("newTabShortcut"),
    contextMenu: document.getElementById("contextMenu"),
    tabPreview: document.getElementById("tabPreview"),
    tabPreviewThumbnail: document.getElementById("tabPreviewThumbnail"),
    tabPreviewImage: document.getElementById("tabPreviewImage"),
    tabPreviewPlaceholder: document.getElementById("tabPreviewPlaceholder"),
    tabPreviewPlaceholderText: document.getElementById("tabPreviewPlaceholderText"),
    tabPreviewLocation: document.getElementById("tabPreviewLocation"),
    tabPreviewFavicon: document.getElementById("tabPreviewFavicon"),
    tabPreviewTitle: document.getElementById("tabPreviewTitle"),
    tabPreviewUrl: document.getElementById("tabPreviewUrl"),
    tabPreviewMeta: document.getElementById("tabPreviewMeta"),
    confirmDialog: document.getElementById("confirmDialog"),
    confirmTitle: document.getElementById("confirmTitle"),
    confirmText: document.getElementById("confirmText"),
    confirmActionButton: document.getElementById("confirmActionButton"),
    toast: document.getElementById("toast"),
    toastText: document.getElementById("toastText"),
    activeThemeProbe: document.getElementById("activeThemeProbe"),
    accentColor: document.getElementById("accentColor"),
    accentColorValue: document.getElementById("accentColorValue"),
    surfaceColor: document.getElementById("surfaceColor"),
    surfaceColorValue: document.getElementById("surfaceColorValue"),
    pickAccentButton: document.getElementById("pickAccentButton"),
    pickSurfaceButton: document.getElementById("pickSurfaceButton"),
    themeTone: document.getElementById("themeTone"),
    tabPreviewsToggle: document.getElementById("tabPreviewsToggle"),
    workspaceOnlyToggle: document.getElementById("workspaceOnlyToggle"),
    supportDevelopmentButton: document.getElementById("supportDevelopmentButton"),
    resetAppearanceButton: document.getElementById("resetAppearanceButton")
  };

  const model = {
    windowId: null,
    tabs: [],
    state: State.createDefaultState(),
    activeWorkspaceId: null,
    activeSplitViewId: null,
    scopeKey: State.makeScopeKey("current", "default"),
    query: "",
    loaded: false,
    refreshGeneration: 0,
    refreshTimer: null,
    settingsSaveTimer: null,
    pendingSettingsChanges: {},
    toastTimer: null,
    confirmResolver: null,
    contextMenuReturnFocus: null,
    previewShowTimer: null,
    previewHideTimer: null,
    previewRow: null,
    previewTabId: null,
    previewThumbnailRequest: 0,
    previewThumbnails: new Map(),
    enteringTabMotions: new Map(),
    drag: null,
    themeSignature: ""
  };

  function createElement(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function islandLabel(group, includeNumber) {
    if (group && typeof group.name === "string" && group.name.trim()) return group.name;
    if (includeNumber && group && Number.isInteger(group.number)) {
      return `Unnamed island ${group.number}`;
    }
    return "Unnamed island";
  }

  function createIcon(name, className) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    if (className) svg.setAttribute("class", className);
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#icon-${name}`);
    svg.append(use);
    return svg;
  }

  function makeIconButton(className, action, iconName, label) {
    const button = createElement("button", className);
    button.type = "button";
    button.dataset.action = action;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.append(createIcon(iconName));
    return button;
  }

  function extensionCall(namespace, method, ...args) {
    return new Promise((resolve, reject) => {
      if (!namespace || typeof namespace[method] !== "function") {
        reject(new Error(`${method} is not supported`));
        return;
      }
      try {
        namespace[method](...args, (result) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            reject(new Error(lastError.message));
            return;
          }
          resolve(result);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function sendExtensionCommand(type, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          reject(new Error(lastError.message));
          return;
        }
        if (!response || !response.ok) {
          reject(new Error((response && response.error) || "The extension did not respond"));
          return;
        }
        resolve(response);
      });
    });
  }

  async function command(type, payload) {
    if (!isExtension) throw new Error("Browser tab access is unavailable");
    const response = await sendExtensionCommand(type, payload || {});
    if (response.state) model.state = State.normalizeState(response.state);
    return response;
  }

  async function initialize() {
    configurePlatformHints();
    bindEvents();
    if (!isExtension) {
      model.loaded = true;
      applySettingsToDocument();
      render();
      elements.loadingState.hidden = true;
      elements.newTabButton.disabled = true;
      elements.createIslandButton.disabled = true;
      syncThemeFromEnvironment();
      return;
    }
    bindExtensionEvents();
    await resolveWindow();
    await refresh({ initial: true });
    syncThemeFromEnvironment();
    window.setInterval(syncThemeFromEnvironment, 1500);
  }

  function configurePlatformHints() {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    elements.searchShortcut.textContent = isMac ? "⌘ K" : "Ctrl K";
    elements.newTabShortcut.textContent = isMac ? "⌘ T" : "Ctrl T";
  }

  async function resolveWindow() {
    const currentWindow = await extensionCall(chrome.windows, "getCurrent");
    model.windowId = currentWindow.id;
  }

  async function refresh(options) {
    const generation = ++model.refreshGeneration;
    try {
      const response = await command("INIT", { windowId: model.windowId });
      if (generation !== model.refreshGeneration) return;

      const nextTabs = (response.tabs || []).slice().sort((a, b) => a.index - b.index);
      const animateTabChanges = model.loaded && !(options && options.initial);
      const previousTabIds = new Set(model.tabs.map((tab) => tab.id));
      const nextTabIds = new Set(nextTabs.map((tab) => tab.id));
      const closingTabIds = animateTabChanges
        ? model.tabs.filter((tab) => !nextTabIds.has(tab.id)).map((tab) => tab.id)
        : [];
      const enteringTabIds = animateTabChanges
        ? nextTabs.filter((tab) => !previousTabIds.has(tab.id)).map((tab) => tab.id)
        : [];

      if (closingTabIds.length) {
        await animateClosingTabs(closingTabIds);
        if (generation !== model.refreshGeneration) return;
      }

      const entryStartedAt = performance.now();
      enteringTabIds.forEach((tabId) => {
        if (!model.enteringTabMotions.has(tabId)) {
          model.enteringTabMotions.set(tabId, entryStartedAt);
        }
      });
      for (const tabId of model.enteringTabMotions.keys()) {
        if (!nextTabIds.has(tabId)) model.enteringTabMotions.delete(tabId);
      }

      model.state = State.normalizeState(response.state);
      model.tabs = nextTabs;
      updateWorkspaceContext();
      applySettingsToDocument();
      model.loaded = true;
      render();
      elements.loadingState.hidden = true;
    } catch (error) {
      console.error(error);
      elements.loadingState.hidden = true;
      showEmpty("Couldn't read tabs", error.message || "Reload the extension and try again.");
    }
  }

  function scheduleRefresh(delay) {
    clearTimeout(model.refreshTimer);
    model.refreshTimer = setTimeout(() => refresh(), delay === undefined ? 80 : delay);
  }

  function updateWorkspaceContext() {
    const focusedTab = model.tabs.find((tab) => tab.active) || null;
    const contextTab = focusedTab || model.tabs[0] || null;
    model.activeSplitViewId = tabSplitViewId(focusedTab);
    model.activeWorkspaceId = contextTab && contextTab.workspaceId !== undefined
      ? contextTab.workspaceId
      : null;
    model.scopeKey = State.makeScopeKey(model.windowId, model.activeWorkspaceId);
  }

  function visibleTabs() {
    const settings = model.state.settings;
    if (!settings.showCurrentWorkspaceOnly || model.activeWorkspaceId === null) {
      return model.tabs.slice();
    }
    return model.tabs.filter((tab) => {
      if (tab.workspaceId === undefined || tab.workspaceId === null) return true;
      return String(tab.workspaceId) === String(model.activeWorkspaceId);
    });
  }

  function tabMatchesQuery(tab) {
    if (!model.query) return true;
    const haystack = `${tab.title || ""}\n${tab.url || tab.pendingUrl || ""}`.toLocaleLowerCase();
    return model.query.split(/\s+/).every((part) => haystack.includes(part));
  }

  function render() {
    if (!model.loaded) return;
    hideTabPreview(true);
    const allVisible = visibleTabs();
    const matching = allVisible.filter(tabMatchesQuery);
    const matchingIds = new Set(matching.map((tab) => tab.id));
    const fragment = document.createDocumentFragment();
    const pinnedTabs = allVisible.filter((tab) => tab.pinned && matchingIds.has(tab.id));
    const regularTabs = allVisible.filter((tab) => !tab.pinned);
    const groupTabs = new Map();

    for (const tab of regularTabs) {
      const groupId = model.state.assignments[String(tab.id)];
      if (!groupId || !model.state.groups[groupId]) continue;
      if (!groupTabs.has(groupId)) groupTabs.set(groupId, []);
      groupTabs.get(groupId).push(tab);
    }

    if (pinnedTabs.length) {
      fragment.append(renderSimpleSection("Pinned", pinnedTabs, "pinned"));
    }

    const orderedGroupIds = orderedGroupsForScope(groupTabs);
    const renderedIslands = [];
    for (const groupId of orderedGroupIds) {
      const group = model.state.groups[groupId];
      if (!group) continue;
      const tabs = (groupTabs.get(groupId) || []).filter((tab) => matchingIds.has(tab.id));
      const hasVisibleMembers = (groupTabs.get(groupId) || []).length > 0;
      const belongsToScope = group.scopeKey === model.scopeKey;
      if (model.query && !tabs.length) continue;
      if (!hasVisibleMembers && !belongsToScope) continue;
      renderedIslands.push(renderIsland(group, tabs, (groupTabs.get(groupId) || []).length));
    }
    if (renderedIslands.length) {
      fragment.append(renderIslandSection(renderedIslands, {
        separated: pinnedTabs.length > 0
      }));
    }

    const looseTabs = regularTabs.filter((tab) => {
      const groupId = model.state.assignments[String(tab.id)];
      return (!groupId || !model.state.groups[groupId]) && matchingIds.has(tab.id);
    });
    if (looseTabs.length) {
      fragment.append(renderSimpleSection("", looseTabs, "loose", {
        // Divider whenever anything renders above Unsorted: pinned tabs or islands.
        separated: pinnedTabs.length > 0 || renderedIslands.length > 0
      }));
    }

    elements.tabTree.replaceChildren(fragment);
    animateEnteringTabs();
    const resultCount = matching.length;
    elements.tabTotal.textContent = model.query
      ? `${resultCount} / ${allVisible.length} TABS`
      : `${allVisible.length} ${allVisible.length === 1 ? "TAB" : "TABS"}`;
    elements.clearSearchButton.hidden = !model.query;

    if (!resultCount && model.query) {
      showEmpty("No tabs found", "Try a title, site, or address.");
    } else if (!allVisible.length) {
      showEmpty("No open tabs", "Open a new tab to start your deck.");
    } else {
      elements.emptyState.hidden = true;
    }
  }

  function tabRowsForIds(tabIds) {
    const wanted = new Set((tabIds || []).map(Number));
    if (!wanted.size) return [];
    return [...elements.tabTree.querySelectorAll(".tab-row")]
      .filter((row) => wanted.has(Number(row.dataset.tabId)));
  }

  function tabRowIsOnScreen(row) {
    const rowRect = row.getBoundingClientRect();
    const viewportRect = elements.tabsViewport.getBoundingClientRect();
    return rowRect.bottom > viewportRect.top &&
      rowRect.top < viewportRect.bottom &&
      rowRect.right > viewportRect.left &&
      rowRect.left < viewportRect.right;
  }

  function waitForTabRowAnimation(row, animationName) {
    // Reading the animation name flushes the class change before getAnimations().
    if (getComputedStyle(row).animationName === "none") return Promise.resolve();
    const animation = row.getAnimations()
      .find((candidate) => candidate.animationName === animationName);
    return animation ? animation.finished.catch(() => undefined) : Promise.resolve();
  }

  function animateEnteringTabs() {
    for (const [tabId, startedAt] of model.enteringTabMotions) {
      const row = tabRowsForIds([tabId])[0];
      if (!row || !tabRowIsOnScreen(row)) {
        model.enteringTabMotions.delete(tabId);
        continue;
      }
      const elapsed = Math.max(0, performance.now() - startedAt);
      row.style.setProperty("--tab-enter-delay", `${-elapsed}ms`);
      row.classList.add("is-entering");
      waitForTabRowAnimation(row, "tab-row-enter").then(() => {
        if (!row.isConnected) return;
        row.classList.remove("is-entering");
        row.style.removeProperty("--tab-enter-delay");
        if (model.enteringTabMotions.get(tabId) === startedAt) {
          model.enteringTabMotions.delete(tabId);
        }
      });
    }
  }

  async function animateClosingTabs(tabIds) {
    const rows = tabRowsForIds(tabIds).filter(tabRowIsOnScreen);
    if (!rows.length) return;
    hideTabPreview(true);
    await Promise.all(rows.map((row) => {
      row.classList.add("is-closing");
      row.setAttribute("aria-hidden", "true");
      row.tabIndex = -1;
      row.draggable = false;
      return waitForTabRowAnimation(row, "tab-row-close");
    }));
  }

  function orderedGroupsForScope(groupTabs) {
    const scopedOrder = model.state.scopeOrders[model.scopeKey] || [];
    const memberGroupIds = [...groupTabs.keys()];
    const scopedEmptyIds = Object.values(model.state.groups)
      .filter((group) => group.scopeKey === model.scopeKey)
      .map((group) => group.id);
    return [...new Set([...scopedOrder, ...memberGroupIds, ...scopedEmptyIds])];
  }

  function renderSimpleSection(label, tabs, kind, options) {
    const section = createElement("section", "tab-section");
    section.setAttribute("aria-label", label || "Unsorted");
    section.dataset.dropKind = kind;
    if (kind === "loose") section.dataset.groupId = "";
    if (options && options.separated) section.classList.add("has-section-separator");
    const list = createElement("div", "tab-list");
    if (tabs.length) {
      list.setAttribute("role", "list");
      tabs.forEach((tab) => list.append(renderTab(tab)));
    }
    if (label) section.append(renderSectionLabel(label));
    section.append(list);
    return section;
  }

  function renderSectionLabel(label) {
    const heading = createElement("div", "section-label");
    heading.append(createElement("span", "", label));
    return heading;
  }

  function renderIslandSection(islands, options) {
    const section = createElement("section", "islands-section");
    section.setAttribute("aria-label", "Islands");
    if (options && options.separated) section.classList.add("has-section-separator");
    const list = createElement("div", "islands-section__list");
    list.append(...islands);
    section.append(renderSectionLabel("Islands"), list);
    return section;
  }

  function renderIsland(group, tabs, totalCount) {
    const section = createElement("section", "island");
    const label = islandLabel(group);
    const unnamed = !group.name;
    section.setAttribute("aria-label", `${label}, ${totalCount} ${totalCount === 1 ? "tab" : "tabs"}`);
    section.dataset.groupId = group.id;
    section.dataset.color = group.color;
    section.dataset.dropKind = "group";
    section.classList.toggle("is-unnamed", unnamed);
    const forceExpanded = Boolean(model.query);
    const expanded = forceExpanded || !group.collapsed;
    section.classList.toggle("is-expanded", expanded);

    const header = createElement("header", "island-header");
    const grip = createElement("span", "group-grip");
    grip.dataset.dragGroup = group.id;
    grip.draggable = true;
    grip.title = "Drag to reorder island";
    grip.append(createIcon("grip"));

    const toggle = makeIconButton("island-toggle", "toggle-group", "chevron", expanded ? "Collapse island" : "Expand island");
    toggle.dataset.groupId = group.id;
    toggle.setAttribute("aria-expanded", String(expanded));

    const titleWrap = createElement("div", "island-title-wrap");
    const title = createElement("button", "island-title", group.name);
    title.type = "button";
    title.dataset.action = "rename-group";
    title.dataset.groupId = group.id;
    title.classList.toggle("is-unnamed", unnamed);
    title.setAttribute("aria-label", unnamed ? "Name island" : `Rename ${group.name}`);
    title.title = unnamed ? "Name island" : "Click to rename";
    const count = createElement("span", "island-count", totalCount);
    titleWrap.append(title, count);

    const addButton = makeIconButton("island-action", "new-tab-in-group", "plus", "New tab in island");
    addButton.dataset.groupId = group.id;
    const menuButton = makeIconButton("island-action", "group-menu", "more", `More actions for ${label}`);
    menuButton.dataset.groupId = group.id;
    header.append(grip, toggle, titleWrap, addButton, menuButton);

    const tabList = createElement("div", "island-tabs");
    tabList.setAttribute("role", "list");
    if (tabs.length) {
      tabs.forEach((tab) => tabList.append(renderTab(tab)));
    } else if (!model.query) {
      tabList.append(createElement("div", "island-empty", "Drop a tab here"));
    }

    section.append(header, tabList);
    return section;
  }

  function renderTab(tab) {
    const row = createElement("div", "tab-row");
    const splitViewId = tabSplitViewId(tab);
    const inSplitView = splitViewId !== null;
    const visibleInActiveSplit = inSplitView && splitViewId === model.activeSplitViewId;
    row.dataset.tabId = String(tab.id);
    if (inSplitView) row.dataset.splitViewId = String(splitViewId);
    row.classList.toggle("is-active", Boolean(tab.active));
    row.classList.toggle("is-split", inSplitView);
    row.classList.toggle("is-split-visible", visibleInActiveSplit);
    row.classList.toggle("is-discarded", Boolean(tab.discarded));
    row.draggable = !tab.pinned;
    row.tabIndex = 0;
    row.setAttribute("role", "listitem");
    const activeDescription = tab.active
      ? (inSplitView ? ", focused split pane" : ", active")
      : (visibleInActiveSplit ? ", visible split pane" : (inSplitView ? ", split screen" : ""));
    row.setAttribute("aria-label", `${tab.title || "Untitled tab"}${activeDescription}`);
    row.addEventListener("mouseenter", () => scheduleTabPreview(tab, row, 320));
    row.addEventListener("mouseleave", () => scheduleTabPreviewHide(row));
    row.addEventListener("focusin", () => scheduleTabPreview(tab, row, 120));
    row.addEventListener("focusout", (event) => {
      if (!row.contains(event.relatedTarget)) scheduleTabPreviewHide(row);
    });

    const faviconWrap = createElement("span", "tab-favicon-wrap");
    const fallback = createElement("span", "tab-fallback", fallbackLetter(tab));
    const directFaviconUrl = Resources.safeFaviconUrl(tab.favIconUrl);
    const browserFaviconUrl = typeof tab.favIconUrl === "string" && tab.favIconUrl.trim()
      ? Resources.browserFaviconUrl(tab.url || tab.pendingUrl, faviconEndpoint)
      : "";
    const faviconUrl = browserFaviconUrl || directFaviconUrl;
    if (faviconUrl) {
      const image = createElement("img", "tab-favicon");
      image.alt = "";
      image.draggable = false;
      image.referrerPolicy = "no-referrer";
      image.hidden = true;
      image.addEventListener("load", () => {
        image.hidden = false;
        fallback.hidden = true;
        requestAnimationFrame(() => updateFaviconContrast(image));
      }, { once: true });
      image.addEventListener("error", () => {
        image.hidden = true;
        fallback.hidden = false;
      }, { once: true });
      image.src = faviconUrl;
      faviconWrap.append(image);
    }
    faviconWrap.append(fallback);
    if (tab.status === "loading") faviconWrap.append(createElement("span", "tab-loading-ring"));

    const copy = createElement("span", "tab-copy");
    const title = createElement("span", "tab-title", tab.title || "Untitled tab");
    const address = createElement("span", "tab-url", displayAddress(tab.url || tab.pendingUrl));
    copy.append(title, address);

    const indicators = createElement("span", "tab-indicators");
    if (inSplitView) {
      const split = createElement("span", "tab-indicator tab-indicator--split");
      const splitLabel = tab.active
        ? "Focused split pane"
        : (visibleInActiveSplit ? "Visible split pane" : "Split screen tab");
      split.title = splitLabel;
      split.setAttribute("aria-label", splitLabel);
      split.append(createIcon("split"));
      indicators.append(split);
    }
    if (tab.pinned) {
      const pin = createElement("span", "tab-indicator");
      pin.title = "Pinned";
      pin.append(createIcon("pin"));
      indicators.append(pin);
    }
    if (tab.audible || (tab.mutedInfo && tab.mutedInfo.muted)) {
      const muted = Boolean(tab.mutedInfo && tab.mutedInfo.muted);
      const audio = makeIconButton(
        `tab-indicator${tab.audible && !muted ? " is-audible" : ""}`,
        "toggle-mute",
        muted ? "volume-off" : "volume",
        muted ? "Unmute tab" : "Mute tab"
      );
      audio.dataset.tabId = String(tab.id);
      indicators.append(audio);
    }

    const close = makeIconButton("tab-close", "close-tab", "x", "Close tab");
    close.dataset.tabId = String(tab.id);
    row.append(faviconWrap, copy, indicators, close);
    return row;
  }

  function scheduleTabPreview(tab, row, delay) {
    if (
      !model.state.settings.showTabPreviews ||
      !tab ||
      !row ||
      model.drag ||
      elements.settingsDrawer.classList.contains("is-open") ||
      !elements.contextMenu.hidden
    ) {
      return;
    }

    clearTimeout(model.previewShowTimer);
    clearTimeout(model.previewHideTimer);
    model.previewShowTimer = null;
    model.previewHideTimer = null;
    if (model.previewRow && model.previewRow !== row) hideTabPreview(true);
    if (model.previewRow === row && !elements.tabPreview.hidden) return;

    model.previewShowTimer = setTimeout(() => {
      model.previewShowTimer = null;
      showTabPreview(tab, row);
    }, delay);
  }

  function scheduleTabPreviewHide(row) {
    clearTimeout(model.previewShowTimer);
    clearTimeout(model.previewHideTimer);
    model.previewShowTimer = null;
    model.previewHideTimer = setTimeout(() => {
      model.previewHideTimer = null;
      if (
        row &&
        row.isConnected &&
        (row.matches(":hover") || row.contains(document.activeElement))
      ) {
        return;
      }
      hideTabPreview();
    }, 80);
  }

  function showTabPreview(tab, row) {
    if (
      !model.state.settings.showTabPreviews ||
      !row.isConnected ||
      model.drag ||
      elements.settingsDrawer.classList.contains("is-open") ||
      !elements.contextMenu.hidden
    ) {
      return;
    }

    const currentTab = tabById(tab.id) || tab;
    const previousRow = model.previewRow;
    if (previousRow && previousRow !== row && previousRow.isConnected) {
      previousRow.removeAttribute("aria-describedby");
    }
    clearTimeout(model.previewHideTimer);
    model.previewHideTimer = null;
    model.previewRow = row;
    model.previewTabId = currentTab.id;
    row.setAttribute("aria-describedby", "tabPreview");

    elements.tabPreviewLocation.textContent = tabPreviewLocation(currentTab);
    elements.tabPreviewTitle.textContent = currentTab.title || "Untitled tab";
    elements.tabPreviewUrl.textContent = currentTab.url || currentTab.pendingUrl || "No address available";
    populateTabPreviewFavicon(currentTab, row);
    populateTabPreviewMeta(currentTab);
    loadTabPreviewThumbnail(currentTab);

    const accent = getComputedStyle(row).getPropertyValue("--tab-accent").trim();
    elements.tabPreview.style.setProperty("--preview-accent", accent || "var(--accent)");
    elements.tabPreview.hidden = false;
    elements.tabPreview.setAttribute("aria-hidden", "false");
    positionTabPreview(row);
    requestAnimationFrame(() => {
      if (model.previewRow === row && !elements.tabPreview.hidden) {
        elements.tabPreview.classList.add("is-visible");
      }
    });
  }

  function hideTabPreview(immediate) {
    clearTimeout(model.previewShowTimer);
    clearTimeout(model.previewHideTimer);
    model.previewShowTimer = null;
    model.previewHideTimer = null;
    if (model.previewRow && model.previewRow.isConnected) {
      model.previewRow.removeAttribute("aria-describedby");
    }
    model.previewRow = null;
    model.previewTabId = null;
    model.previewThumbnailRequest += 1;
    elements.tabPreview.classList.remove("is-visible");
    elements.tabPreview.setAttribute("aria-hidden", "true");
    if (immediate || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      elements.tabPreview.hidden = true;
      return;
    }
    model.previewHideTimer = setTimeout(() => {
      model.previewHideTimer = null;
      if (!model.previewRow) elements.tabPreview.hidden = true;
    }, 130);
  }

  function positionTabPreview(row) {
    const margin = 8;
    const gap = 6;
    const rowRect = row.getBoundingClientRect();
    const previewRect = elements.tabPreview.getBoundingClientRect();
    const left = Math.max(
      margin,
      Math.min(rowRect.left, window.innerWidth - previewRect.width - margin)
    );
    const below = rowRect.bottom + gap;
    const above = rowRect.top - previewRect.height - gap;
    const preferredTop = below + previewRect.height <= window.innerHeight - margin
      ? below
      : above;
    const top = Math.max(
      margin,
      Math.min(preferredTop, window.innerHeight - previewRect.height - margin)
    );
    elements.tabPreview.style.left = `${Math.round(left)}px`;
    elements.tabPreview.style.top = `${Math.round(top)}px`;
  }

  function tabPreviewLocation(tab) {
    if (tab.pinned) return "Pinned";
    const groupId = model.state.assignments[String(tab.id)];
    const group = model.state.groups[groupId];
    return group ? islandLabel(group, true) : "Unsorted";
  }

  function populateTabPreviewFavicon(tab, row) {
    elements.tabPreviewFavicon.replaceChildren();
    const source = row.querySelector(".tab-favicon:not([hidden])");
    if (source) {
      const image = source.cloneNode(false);
      image.classList.remove("tab-favicon");
      image.classList.add("tab-preview__favicon-image");
      image.hidden = false;
      elements.tabPreviewFavicon.append(image);
      return;
    }
    elements.tabPreviewFavicon.append(
      createElement("span", "tab-preview__favicon-fallback", fallbackLetter(tab))
    );
  }

  async function loadTabPreviewThumbnail(tab) {
    const requestId = ++model.previewThumbnailRequest;
    const tabUrl = tab.url || tab.pendingUrl || "";
    const screenPreviewSupported = supportsScreenPreview(tabUrl);
    if (!isExtension) {
      showDetailsOnlyTabPreview();
      return;
    }
    if (tab.active || !screenPreviewSupported) {
      if (!screenPreviewSupported) model.previewThumbnails.delete(tab.id);
      showDetailsOnlyTabPreview();
      if (tab.active && screenPreviewSupported && isExtension) {
        sendExtensionCommand("TAB_PREVIEW_GET", { tabId: tab.id })
          .then((response) => {
            if (isSafeThumbnail(response.thumbnail)) {
              model.previewThumbnails.set(tab.id, {
                thumbnail: response.thumbnail,
                url: typeof response.url === "string" ? response.url : tabUrl
              });
            }
          })
          .catch(() => undefined);
      }
      return;
    }

    elements.tabPreview.classList.remove("is-details-only");
    elements.tabPreviewThumbnail.hidden = false;
    const local = model.previewThumbnails.get(tab.id);
    const hasLocal = Boolean(local && local.url === tabUrl && isSafeThumbnail(local.thumbnail));

    if (hasLocal) {
      showTabPreviewThumbnail(local.thumbnail, requestId);
    } else {
      showTabPreviewThumbnailStatus("Loading page preview…", "is-loading");
    }

    try {
      const response = await sendExtensionCommand("TAB_PREVIEW_GET", { tabId: tab.id });
      if (requestId !== model.previewThumbnailRequest || model.previewTabId !== tab.id) return;
      if (response.detailsOnly) {
        showDetailsOnlyTabPreview();
      } else if (isSafeThumbnail(response.thumbnail)) {
        const capturedUrl = typeof response.url === "string" ? response.url : tabUrl;
        model.previewThumbnails.set(tab.id, {
          thumbnail: response.thumbnail,
          url: capturedUrl
        });
        showTabPreviewThumbnail(response.thumbnail, requestId);
      } else if (!hasLocal) {
        showTabPreviewThumbnailStatus(
          response.reason || "Open this tab to capture a preview",
          "is-empty"
        );
      }
    } catch (_error) {
      if (requestId === model.previewThumbnailRequest && !hasLocal) {
        showDetailsOnlyTabPreview();
      }
    }
  }

  function showTabPreviewThumbnail(thumbnail, requestId) {
    elements.tabPreviewThumbnail.classList.remove("is-loading", "is-empty");
    elements.tabPreviewThumbnail.classList.add("is-ready");
    elements.tabPreviewPlaceholder.hidden = true;
    elements.tabPreviewImage.hidden = true;
    elements.tabPreviewImage.onload = () => {
      if (requestId === model.previewThumbnailRequest) {
        elements.tabPreviewImage.hidden = false;
      }
    };
    elements.tabPreviewImage.onerror = () => {
      if (requestId === model.previewThumbnailRequest) {
        showDetailsOnlyTabPreview();
      }
    };
    elements.tabPreviewImage.src = thumbnail;
  }

  function showTabPreviewThumbnailStatus(message, stateClass) {
    elements.tabPreviewImage.onload = null;
    elements.tabPreviewImage.onerror = null;
    elements.tabPreviewImage.hidden = true;
    elements.tabPreviewImage.removeAttribute("src");
    elements.tabPreviewThumbnail.classList.remove("is-loading", "is-empty", "is-ready");
    elements.tabPreviewThumbnail.classList.add(stateClass);
    elements.tabPreviewPlaceholderText.textContent = message;
    elements.tabPreviewPlaceholder.hidden = false;
  }

  function showDetailsOnlyTabPreview() {
    elements.tabPreview.classList.add("is-details-only");
    elements.tabPreviewThumbnail.hidden = true;
    elements.tabPreviewImage.onload = null;
    elements.tabPreviewImage.onerror = null;
    elements.tabPreviewImage.hidden = true;
    elements.tabPreviewImage.removeAttribute("src");
  }

  function supportsScreenPreview(value) {
    if (typeof value !== "string" || !value) return false;
    try {
      const protocol = new URL(value).protocol;
      return protocol === "http:" || protocol === "https:";
    } catch (_error) {
      return false;
    }
  }

  function isSafeThumbnail(value) {
    return typeof value === "string" && /^data:image\/(?:jpeg|png|webp);base64,/i.test(value);
  }

  function populateTabPreviewMeta(tab) {
    const labels = [];
    const splitViewId = tabSplitViewId(tab);
    if (splitViewId !== null) {
      if (tab.active) labels.push("Focused split pane");
      else if (splitViewId === model.activeSplitViewId) labels.push("Visible split pane");
      else labels.push("Split screen");
    } else if (tab.active) {
      labels.push("Active");
    }
    if (tab.pinned) labels.push("Pinned");
    if (tab.status === "loading") labels.push("Loading");
    if (tab.discarded) labels.push("Sleeping");
    if (tab.mutedInfo && tab.mutedInfo.muted) labels.push("Muted");
    else if (tab.audible) labels.push("Playing audio");
    if (!labels.length) labels.push("Open tab");
    elements.tabPreviewMeta.replaceChildren(
      ...labels.map((label) => createElement("span", "tab-preview__badge", label))
    );
  }

  function renderedBackgroundRgb(element) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;

    context.fillStyle = document.documentElement.dataset.tone === "light" ? "#ffffff" : "#000000";
    context.fillRect(0, 0, 1, 1);
    const layers = [];
    for (let current = element; current; current = current.parentElement) layers.unshift(current);
    for (const layer of layers) {
      const color = getComputedStyle(layer).backgroundColor;
      if (!color || color === "transparent") continue;
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
    }
    return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
  }

  function updateFaviconContrast(image) {
    image.classList.remove("is-contrast-inverted");
    const wrap = image.closest(".tab-favicon-wrap");
    if (!wrap || !image.complete || !image.naturalWidth || !image.naturalHeight) return;

    try {
      const size = 32;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      const background = renderedBackgroundRgb(wrap);
      if (!context || !background) return;

      const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.imageSmoothingEnabled = true;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      const pixels = context.getImageData(0, 0, size, size).data;
      const shouldInvert = Resources.shouldInvertFavicon(pixels, background);
      image.classList.toggle("is-contrast-inverted", shouldInvert);
    } catch (_error) {
      // Some browser-owned icon schemes cannot be sampled. Keep their original colors.
    }
  }

  function refreshFaviconContrast() {
    document.querySelectorAll(".tab-favicon").forEach((image) => {
      if (image.complete && image.naturalWidth) updateFaviconContrast(image);
    });
  }

  function fallbackLetter(tab) {
    const text = (tab.title || displayAddress(tab.url) || "T").trim();
    return text ? text[0] : "T";
  }

  function displayAddress(value) {
    if (!value) return "New tab";
    try {
      const url = new URL(value);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.hostname.replace(/^www\./, "");
      }
      return `${url.protocol.replace(":", "")}://${url.hostname || url.pathname.split("/")[0]}`;
    } catch (_error) {
      return value;
    }
  }

  function showEmpty(title, text) {
    elements.emptyStateTitle.textContent = title;
    elements.emptyStateText.textContent = text;
    elements.emptyState.hidden = false;
  }

  function activeTab() {
    return visibleTabs().find((tab) => tab.active) || model.tabs.find((tab) => tab.active) || null;
  }

  function tabSplitViewId(tab) {
    if (!tab || typeof tab !== "object") return null;
    for (const value of [tab.splitViewId, tab.splitScreenId]) {
      if (Number.isInteger(value) && value >= 0) return value;
    }
    return null;
  }

  function splitViewTabs(tab) {
    const splitViewId = tabSplitViewId(tab);
    if (splitViewId === null) return tab ? [tab] : [];
    return model.tabs.filter((candidate) => tabSplitViewId(candidate) === splitViewId);
  }

  function tabById(tabId) {
    return model.tabs.find((tab) => tab.id === Number(tabId)) || null;
  }

  async function createIsland(tabIds, options) {
    const groupableTabIds = (tabIds || []).filter((tabId) => {
      const tab = tabById(tabId);
      return !tab || !tab.pinned;
    });
    const response = await command("GROUP_CREATE", {
      tabIds: groupableTabIds,
      scopeKey: model.scopeKey,
      windowId: model.windowId,
      workspaceId: model.activeWorkspaceId,
      name: options && options.name,
      color: options && options.color
    });
    render();
    const group = model.state.groups[response.groupId];
    showToast(group && group.name ? `Created ${group.name}` : "Created unnamed island");
    if (options && options.rename === true) {
      requestAnimationFrame(() => beginRenameGroup(response.groupId));
    }
    return response.groupId;
  }

  async function createIslandFromActiveTab() {
    const tab = activeTab();
    if (tab && tab.pinned) {
      showToast("Unpin the active tab before adding it to an island");
      return;
    }
    await createIsland(tab ? splitViewTabs(tab).map((member) => member.id) : []);
  }

  async function createNewTab(groupId) {
    const tab = await extensionCall(chrome.tabs, "create", {
      windowId: model.windowId,
      active: true
    });
    if (groupId && tab && Number.isInteger(tab.id)) {
      await command("GROUP_ASSIGN", { groupId, tabIds: [tab.id] });
    }
    scheduleRefresh(0);
  }

  async function activateTab(tabId) {
    await extensionCall(chrome.tabs, "update", tabId, { active: true });
    try {
      await extensionCall(chrome.windows, "update", model.windowId, { focused: true });
    } catch (_error) {
      // Focusing is best-effort when Opera keeps the sidebar active.
    }
    scheduleRefresh(0);
  }

  async function closeTabs(tabIds) {
    if (!tabIds.length) return;
    await extensionCall(chrome.tabs, "remove", tabIds.length === 1 ? tabIds[0] : tabIds);
    scheduleRefresh(0);
  }

  async function updateTab(tabId, changes) {
    await extensionCall(chrome.tabs, "update", tabId, changes);
    scheduleRefresh(0);
  }

  async function togglePinnedTab(tab) {
    if (!tab) return;
    if (!tab.pinned && model.state.assignments[String(tab.id)]) {
      await command("TAB_UNASSIGN", { tabIds: [tab.id] });
    }
    await updateTab(tab.id, { pinned: !tab.pinned });
  }

  async function reloadTab(tabId) {
    await extensionCall(chrome.tabs, "reload", tabId);
    scheduleRefresh();
  }

  async function duplicateTab(tabId) {
    const sourceGroupId = model.state.assignments[String(tabId)];
    const duplicate = await extensionCall(chrome.tabs, "duplicate", tabId);
    if (
      duplicate &&
      Number.isInteger(duplicate.id) &&
      !duplicate.pinned &&
      model.state.groups[sourceGroupId]
    ) {
      await command("GROUP_ASSIGN", { groupId: sourceGroupId, tabIds: [duplicate.id] });
    }
    scheduleRefresh(0);
  }

  async function moveTabRelative(tabId, targetTabId, placeAfter) {
    if (tabId === targetTabId) return;
    try {
      const [source, target] = await Promise.all([
        extensionCall(chrome.tabs, "get", tabId),
        extensionCall(chrome.tabs, "get", targetTabId)
      ]);
      if (!source || !target || source.windowId !== target.windowId) return;
      const index = Interactions.tabDropIndex(source.index, target.index, placeAfter);
      if (!Number.isInteger(index) || index === source.index) return;
      await extensionCall(chrome.tabs, "move", tabId, { index });
    } catch (error) {
      showToast(`Opera kept the native tab order: ${error.message}`);
    }
  }

  function bindEvents() {
    elements.createIslandButton.addEventListener("click", () => runAction(createIslandFromActiveTab));
    elements.newTabButton.addEventListener("click", () => runAction(() => createNewTab()));
    elements.settingsButton.addEventListener("click", openSettings);
    elements.closeSettingsButton.addEventListener("click", closeSettings);
    elements.drawerScrim.addEventListener("click", closeSettings);

    elements.tabSearch.addEventListener("input", () => {
      model.query = elements.tabSearch.value.trim().toLocaleLowerCase();
      render();
    });
    elements.clearSearchButton.addEventListener("click", clearSearch);

    elements.tabTree.addEventListener("click", onTreeClick);
    elements.tabTree.addEventListener("dblclick", onTreeDoubleClick);
    elements.tabTree.addEventListener("contextmenu", onTreeContextMenu);
    elements.tabTree.addEventListener("keydown", onTreeKeyDown);
    elements.tabTree.addEventListener("pointerdown", () => hideTabPreview(true));
    elements.tabTree.addEventListener("dragstart", onDragStart);
    elements.tabTree.addEventListener("dragover", onDragOver);
    elements.tabTree.addEventListener("drop", onDrop);
    elements.tabTree.addEventListener("dragend", clearDragState);

    document.addEventListener("click", (event) => {
      if (!elements.contextMenu.hidden && !elements.contextMenu.contains(event.target)) {
        closeContextMenu(false);
      }
    });
    document.addEventListener("keydown", onGlobalKeyDown);
    elements.tabsViewport.addEventListener("scroll", () => hideTabPreview(true), { passive: true });
    window.addEventListener("resize", () => {
      closeContextMenu(false);
      hideTabPreview(true);
    });
    elements.contextMenu.addEventListener("keydown", onContextMenuKeyDown);

    elements.confirmDialog.addEventListener("close", () => {
      if (model.confirmResolver) {
        model.confirmResolver(elements.confirmDialog.returnValue === "confirm");
        model.confirmResolver = null;
      }
    });

    bindSettingsEvents();
  }

  function bindExtensionEvents() {
    if (!isExtension) return;
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === "GX_TAB_DECK_CHANGED") scheduleRefresh();
    });

    for (const eventName of ["onCreated", "onRemoved", "onUpdated", "onMoved", "onActivated", "onAttached", "onDetached"]) {
      const event = chrome.tabs[eventName];
      if (event && typeof event.addListener === "function") event.addListener(() => scheduleRefresh());
    }

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleRefresh(0);
    });
  }

  function onTreeClick(event) {
    const actionTarget = event.target.closest("[data-action]");
    if (actionTarget) {
      event.stopPropagation();
      handleTreeAction(actionTarget, event);
      return;
    }

    const row = event.target.closest(".tab-row");
    if (row) runAction(() => activateTab(Number(row.dataset.tabId)));
  }

  function handleTreeAction(target, event) {
    const action = target.dataset.action;
    const tabId = Number(target.dataset.tabId);
    const groupId = target.dataset.groupId;
    switch (action) {
      case "close-tab":
        runAction(() => closeTabs([tabId]));
        break;
      case "toggle-mute": {
        const tab = tabById(tabId);
        if (tab) runAction(() => updateTab(tabId, { muted: !(tab.mutedInfo && tab.mutedInfo.muted) }));
        break;
      }
      case "toggle-group": {
        const group = model.state.groups[groupId];
        if (group) runAction(async () => {
          await command("GROUP_TOGGLE", { groupId, collapsed: !group.collapsed });
          render();
        });
        break;
      }
      case "new-tab-in-group":
        runAction(() => createNewTab(groupId));
        break;
      case "group-menu":
        showGroupMenu(groupId, target);
        break;
      case "rename-group":
        beginRenameGroup(groupId);
        break;
      default:
        if (event) event.preventDefault();
    }
  }

  function onTreeDoubleClick(event) {
    const title = event.target.closest(".island-title");
    if (title) {
      event.preventDefault();
      beginRenameGroup(title.dataset.groupId);
    }
  }

  function onTreeContextMenu(event) {
    const row = event.target.closest(".tab-row");
    if (row) {
      event.preventDefault();
      row.focus({ preventScroll: true });
      showTabMenu(Number(row.dataset.tabId), event.clientX, event.clientY);
      return;
    }
    const island = event.target.closest(".island");
    if (island) {
      event.preventDefault();
      showGroupMenu(island.dataset.groupId, null, event.clientX, event.clientY);
    }
  }

  function onTreeKeyDown(event) {
    const row = event.target.closest(".tab-row");
    const title = event.target.closest(".island-title");
    if (title && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      beginRenameGroup(title.dataset.groupId);
      return;
    }
    if (!row) return;
    const tabId = Number(row.dataset.tabId);
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      runAction(() => activateTab(tabId));
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      runAction(() => closeTabs([tabId]));
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const rows = [...elements.tabTree.querySelectorAll(".tab-row")];
      const current = rows.indexOf(row);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const next = rows[(current + direction + rows.length) % rows.length];
      if (next) next.focus();
    } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      const rect = row.getBoundingClientRect();
      showTabMenu(tabId, rect.left + 12, rect.top + 12);
    }
  }

  function onGlobalKeyDown(event) {
    const commandKey = event.metaKey || event.ctrlKey;
    if (
      commandKey &&
      event.key.toLocaleLowerCase() === "k" &&
      !elements.settingsDrawer.classList.contains("is-open")
    ) {
      event.preventDefault();
      elements.tabSearch.focus();
      elements.tabSearch.select();
      return;
    }
    if (event.key !== "Escape") return;
    if (!elements.contextMenu.hidden) {
      closeContextMenu();
    } else if (elements.settingsDrawer.classList.contains("is-open")) {
      closeSettings();
    } else if (model.query) {
      clearSearch();
    }
  }

  function onContextMenuKeyDown(event) {
    const buttons = [...elements.contextMenu.querySelectorAll('[role^="menuitem"]:not(:disabled)')];
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement);
    let next = null;
    if (event.key === "ArrowDown") next = buttons[(current + 1 + buttons.length) % buttons.length];
    else if (event.key === "ArrowUp") next = buttons[(current - 1 + buttons.length) % buttons.length];
    else if (event.key === "Home") next = buttons[0];
    else if (event.key === "End") next = buttons[buttons.length - 1];
    else if (event.key === "Escape") {
      event.preventDefault();
      closeContextMenu();
      return;
    }
    if (next) {
      event.preventDefault();
      next.focus({ preventScroll: true });
    }
  }

  function clearSearch() {
    elements.tabSearch.value = "";
    model.query = "";
    render();
    elements.tabSearch.focus();
  }

  async function runAction(action) {
    try {
      await action();
    } catch (error) {
      console.error(error);
      showToast(error.message || "That action could not be completed");
    }
  }

  function beginRenameGroup(groupId) {
    const group = model.state.groups[groupId];
    const island = [...elements.tabTree.querySelectorAll(".island")]
      .find((candidate) => candidate.dataset.groupId === groupId);
    if (!group || !island) return;
    const title = island.querySelector(".island-title");
    const wrap = island.querySelector(".island-title-wrap");
    if (!title || wrap.querySelector("input")) return;

    const input = createElement("input", "island-title-input");
    input.type = "text";
    input.maxLength = 80;
    input.value = group.name;
    input.placeholder = "Island name";
    input.setAttribute("aria-label", "Island name");
    title.hidden = true;
    wrap.insertBefore(input, title.nextSibling);
    input.focus();
    input.select();
    let finished = false;

    const finish = async (commit) => {
      if (finished) return;
      finished = true;
      if (!commit) {
        input.remove();
        title.hidden = false;
        return;
      }
      try {
        await command("GROUP_RENAME", { groupId, name: input.value });
        render();
        const renamed = model.state.groups[groupId];
        if (renamed) {
          showToast(renamed.name ? `Island named ${renamed.name}` : "Island name removed");
        }
      } catch (error) {
        input.remove();
        title.hidden = false;
        showToast(error.message);
      }
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        finish(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true), { once: true });
  }

  function showGroupMenu(groupId, anchor, x, y) {
    const group = model.state.groups[groupId];
    if (!group) return;
    const tabIds = State.listGroupTabIds(model.state, groupId);
    const currentActiveTab = activeTab();
    const items = [
      menuAction(group.name ? "Rename island" : "Name island", "edit", () => beginRenameGroup(groupId)),
      menuAction("New tab in island", "plus", () => runAction(() => createNewTab(groupId))),
      currentActiveTab && !currentActiveTab.pinned ? menuAction(
        splitViewTabs(currentActiveTab).length > 1 ? "Move active split here" : "Move active tab here",
        "arrow-island",
        () => {
          if (currentActiveTab) runAction(async () => {
            await command("GROUP_ASSIGN", {
              groupId,
              tabIds: splitViewTabs(currentActiveTab).map((member) => member.id)
            });
            render();
          });
        }
      ) : null,
      menuAction(group.collapsed ? "Expand island" : "Collapse island", "chevron", () => runAction(async () => {
        await command("GROUP_TOGGLE", { groupId, collapsed: !group.collapsed });
        render();
      })),
      { type: "colors", group },
      { type: "separator" },
      menuAction("Remove island", "trash", () => runAction(async () => {
        await command("GROUP_DELETE", { groupId });
        render();
        showToast(tabIds.length ? "Island removed; tabs moved to Unsorted" : "Empty island removed");
      })),
      tabIds.length ? menuAction(`Close ${tabIds.length} ${tabIds.length === 1 ? "tab" : "tabs"}`, "close-stack", async () => {
        const confirmed = await confirmAction(
          `Close ${islandLabel(group)}?`,
          `This will close ${tabIds.length} ${tabIds.length === 1 ? "tab" : "tabs"} in the island.`,
          "Close tabs"
        );
        if (confirmed) {
          await runAction(async () => {
            await command("GROUP_CLOSE", { groupId });
            scheduleRefresh(0);
          });
        }
      }, true) : null
    ].filter(Boolean);

    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      openContextMenu(items, rect.right - 4, rect.bottom + 3);
    } else {
      openContextMenu(items, x, y);
    }
  }

  function showTabMenu(tabId, x, y) {
    const tab = tabById(tabId);
    if (!tab) return;
    const relatedTabIds = splitViewTabs(tab).map((member) => member.id);
    const relatedTabIdSet = new Set(relatedTabIds);
    const currentGroupId = model.state.assignments[String(tabId)];
    const groups = orderedGroupsForScope(new Map()).map((id) => model.state.groups[id]).filter(Boolean);
    const otherIds = visibleTabs()
      .filter((candidate) => !relatedTabIdSet.has(candidate.id) && !candidate.pinned)
      .map((candidate) => candidate.id);
    const islandItems = tab.pinned ? [] : [
      menuAction(
        relatedTabIds.length > 1 ? "New island with split" : "New island with tab",
        "island-plus",
        () => runAction(() => createIsland(relatedTabIds))
      ),
      { type: "label", text: "Move to island" },
      ...groups.slice(0, 8).map((group) => menuAction(
        islandLabel(group, true),
        "arrow-island",
        () => runAction(async () => {
          await command("GROUP_ASSIGN", { groupId: group.id, tabIds: relatedTabIds });
          render();
        }),
        false,
        group.id === currentGroupId ? "Current" : ""
      )),
      currentGroupId ? menuAction("Move to Unsorted", "arrow-island", () => runAction(async () => {
        await command("TAB_UNASSIGN", { tabIds: relatedTabIds });
        render();
      })) : null
    ].filter(Boolean);
    const items = [
      menuAction("Reload", "reload", () => runAction(() => reloadTab(tabId))),
      menuAction(tab.pinned ? "Unpin tab" : "Pin tab", "pin", () => runAction(() => togglePinnedTab(tab))),
      menuAction(tab.mutedInfo && tab.mutedInfo.muted ? "Unmute tab" : "Mute tab", tab.mutedInfo && tab.mutedInfo.muted ? "volume-off" : "volume", () => {
        runAction(() => updateTab(tabId, { muted: !(tab.mutedInfo && tab.mutedInfo.muted) }));
      }),
      menuAction("Duplicate", "copy", () => runAction(() => duplicateTab(tabId))),
      islandItems.length ? { type: "separator" } : null,
      ...islandItems,
      { type: "separator" },
      otherIds.length ? menuAction("Close other tabs", "close-stack", async () => {
        const confirmed = await confirmAction(
          "Close other tabs?",
          `This will close ${otherIds.length} unpinned ${otherIds.length === 1 ? "tab" : "tabs"}.`,
          "Close tabs"
        );
        if (confirmed) await runAction(() => closeTabs(otherIds));
      }) : null,
      menuAction("Close tab", "x", () => runAction(() => closeTabs([tabId])), true)
    ].filter(Boolean);
    openContextMenu(items, x, y);
  }

  function menuAction(label, icon, action, danger, suffix) {
    return { type: "action", label, icon, action, danger: Boolean(danger), suffix: suffix || "" };
  }

  function openContextMenu(items, x, y) {
    const returnFocus = document.activeElement;
    hideTabPreview(true);
    closeContextMenu(false);
    model.contextMenuReturnFocus = returnFocus instanceof HTMLElement ? returnFocus : null;
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      if (item.type === "separator") {
        const separator = createElement("div", "menu-separator");
        separator.setAttribute("role", "separator");
        fragment.append(separator);
      } else if (item.type === "label") {
        const label = createElement("div", "menu-label", item.text);
        label.setAttribute("role", "presentation");
        fragment.append(label);
      } else if (item.type === "colors") {
        fragment.append(createColorMenu(item.group));
      } else if (item.type === "action") {
        const button = createElement("button", `menu-item${item.danger ? " is-danger" : ""}`);
        button.type = "button";
        button.setAttribute("role", "menuitem");
        if (item.icon) button.append(createIcon(item.icon));
        button.append(createElement("span", "", item.label));
        if (item.suffix) button.append(createElement("span", "menu-item__suffix", item.suffix));
        button.addEventListener("click", () => {
          closeContextMenu(false);
          item.action();
        });
        fragment.append(button);
      }
    }
    elements.contextMenu.replaceChildren(fragment);
    elements.contextMenu.hidden = false;
    elements.contextMenu.style.left = "0px";
    elements.contextMenu.style.top = "0px";
    const rect = elements.contextMenu.getBoundingClientRect();
    const left = Math.max(6, Math.min(x, window.innerWidth - rect.width - 6));
    const top = Math.max(6, Math.min(y, window.innerHeight - rect.height - 6));
    elements.contextMenu.style.left = `${left}px`;
    elements.contextMenu.style.top = `${top}px`;
    const firstButton = elements.contextMenu.querySelector("button");
    if (firstButton) firstButton.focus({ preventScroll: true });
  }

  function createColorMenu(group) {
    const wrapper = document.createDocumentFragment();
    const label = createElement("div", "menu-label", "Island color");
    label.setAttribute("role", "presentation");
    wrapper.append(label);
    const colors = createElement("div", "menu-colors");
    colors.setAttribute("role", "presentation");
    for (const color of State.DEFAULT_GROUP_COLORS) {
      const colorLabel = State.GROUP_COLOR_LABELS[color] || `${color[0].toUpperCase()}${color.slice(1)}`;
      const button = createElement("button", `menu-color${group.color === color ? " is-selected" : ""}`);
      button.type = "button";
      button.dataset.color = color;
      button.title = colorLabel;
      button.setAttribute("role", "menuitemradio");
      button.setAttribute("aria-label", `Set island color to ${colorLabel}`);
      button.setAttribute("aria-checked", String(group.color === color));
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        closeContextMenu();
        runAction(async () => {
          await command("GROUP_COLOR", { groupId: group.id, color });
          render();
        });
      });
      colors.append(button);
    }
    wrapper.append(colors);
    const container = createElement("div");
    container.setAttribute("role", "group");
    container.setAttribute("aria-label", "Island color");
    container.append(wrapper);
    return container;
  }

  function closeContextMenu(restoreFocus) {
    const shouldRestoreFocus = restoreFocus !== false;
    const returnFocus = model.contextMenuReturnFocus;
    elements.contextMenu.hidden = true;
    elements.contextMenu.replaceChildren();
    model.contextMenuReturnFocus = null;
    if (shouldRestoreFocus && returnFocus && returnFocus.isConnected) {
      returnFocus.focus({ preventScroll: true });
    }
  }

  function confirmAction(title, text, actionLabel) {
    if (model.confirmResolver) model.confirmResolver(false);
    elements.confirmTitle.textContent = title;
    elements.confirmText.textContent = text;
    elements.confirmActionButton.textContent = actionLabel;
    elements.confirmDialog.returnValue = "cancel";
    elements.confirmDialog.showModal();
    return new Promise((resolve) => {
      model.confirmResolver = resolve;
    });
  }

  function onDragStart(event) {
    hideTabPreview(true);
    const grip = event.target.closest("[data-drag-group]");
    const row = event.target.closest(".tab-row");
    if (grip) {
      model.drag = { type: "group", groupId: grip.dataset.dragGroup };
      grip.closest(".island").classList.add("is-group-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `group:${grip.dataset.dragGroup}`);
    } else if (row) {
      model.drag = { type: "tab", tabId: Number(row.dataset.tabId) };
      row.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", `tab:${row.dataset.tabId}`);
    }
  }

  function onDragOver(event) {
    if (!model.drag) return;
    clearDropIndicators();
    if (model.drag.type === "group") {
      const island = event.target.closest(".island");
      if (!island || island.dataset.groupId === model.drag.groupId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = island.getBoundingClientRect();
      const placeAfter = event.clientY >= rect.top + rect.height / 2;
      island.classList.add(placeAfter ? "is-group-drop-after" : "is-group-drop-before");
      return;
    }

    const island = event.target.closest(".island");
    const loose = event.target.closest('[data-drop-kind="loose"]');
    if (!island && !loose) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const row = event.target.closest(".tab-row");
    if (row && Number(row.dataset.tabId) !== model.drag.tabId) {
      const rect = row.getBoundingClientRect();
      row.classList.add(event.clientY < rect.top + rect.height / 2 ? "is-drop-before" : "is-drop-after");
    } else if (island) {
      island.classList.add("is-group-drop-target");
    } else if (loose) {
      loose.classList.add("is-loose-drop-target");
    }
  }

  function onDrop(event) {
    if (!model.drag) return;
    event.preventDefault();
    if (model.drag.type === "group") {
      const target = event.target.closest(".island");
      if (target && target.dataset.groupId !== model.drag.groupId) {
        const draggedId = model.drag.groupId;
        const targetId = target.dataset.groupId;
        const rect = target.getBoundingClientRect();
        const placeAfter = event.clientY >= rect.top + rect.height / 2;
        runAction(() => reorderGroup(draggedId, targetId, placeAfter));
      }
      clearDragState();
      return;
    }

    const tabId = model.drag.tabId;
    const draggedTab = tabById(tabId);
    const draggedTabIds = splitViewTabs(draggedTab).map((member) => member.id);
    const targetIsland = event.target.closest(".island");
    const loose = event.target.closest('[data-drop-kind="loose"]');
    const targetRow = event.target.closest(".tab-row");
    const dropAfter = targetRow && targetRow.classList.contains("is-drop-after");
    runAction(async () => {
      if (targetIsland) {
        await command("GROUP_ASSIGN", {
          groupId: targetIsland.dataset.groupId,
          tabIds: draggedTabIds
        });
      } else if (loose) {
        await command("TAB_UNASSIGN", { tabIds: draggedTabIds });
      }

      if (targetRow && Number(targetRow.dataset.tabId) !== tabId) {
        await moveTabRelative(tabId, Number(targetRow.dataset.tabId), dropAfter);
      }
      scheduleRefresh(0);
    });
    clearDragState();
  }

  async function reorderGroup(draggedId, targetId, placeAfter) {
    const order = orderedGroupsForScope(new Map());
    const nextOrder = Interactions.moveItemRelative(
      order,
      draggedId,
      targetId,
      placeAfter
    );
    if (nextOrder.every((groupId, index) => groupId === order[index])) return;
    await command("GROUP_REORDER", { scopeKey: model.scopeKey, orderedIds: nextOrder });
    render();
  }

  function clearDropIndicators() {
    elements.tabTree.querySelectorAll(
      ".is-drop-before, .is-drop-after, .is-group-drop-target, .is-group-drop-before, .is-group-drop-after, .is-loose-drop-target"
    ).forEach((node) => node.classList.remove(
      "is-drop-before",
      "is-drop-after",
      "is-group-drop-target",
      "is-group-drop-before",
      "is-group-drop-after",
      "is-loose-drop-target"
    ));
  }

  function clearDragState() {
    elements.tabTree.querySelectorAll(
      ".is-dragging, .is-group-dragging, .is-drop-before, .is-drop-after, .is-group-drop-target, .is-group-drop-before, .is-group-drop-after, .is-loose-drop-target"
    ).forEach((node) => node.classList.remove(
      "is-dragging",
      "is-group-dragging",
      "is-drop-before",
      "is-drop-after",
      "is-group-drop-target",
      "is-group-drop-before",
      "is-group-drop-after",
      "is-loose-drop-target"
    ));
    model.drag = null;
  }

  function openSettings() {
    hideTabPreview(true);
    closeContextMenu(false);
    syncSettingsControls();
    elements.appShell.inert = true;
    elements.settingsDrawer.classList.add("is-open");
    elements.settingsDrawer.setAttribute("aria-hidden", "false");
    elements.drawerScrim.hidden = false;
    requestAnimationFrame(() => elements.closeSettingsButton.focus());
  }

  function closeSettings() {
    elements.settingsDrawer.classList.remove("is-open");
    elements.settingsDrawer.setAttribute("aria-hidden", "true");
    elements.drawerScrim.hidden = true;
    elements.appShell.inert = false;
    elements.settingsButton.focus({ preventScroll: true });
  }

  function bindSettingsEvents() {
    document.querySelectorAll('input[name="themeSource"]').forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) saveSettings({ themeSource: input.value }, true);
      });
    });
    document.querySelectorAll('input[name="density"]').forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) saveSettings({ density: input.value }, true);
      });
    });

    elements.accentColor.addEventListener("input", () => {
      elements.accentColorValue.value = elements.accentColor.value.toUpperCase();
      document.documentElement.style.setProperty("--custom-accent", elements.accentColor.value);
      queueSettingsSave({ customAccent: elements.accentColor.value });
    });
    elements.surfaceColor.addEventListener("input", () => {
      elements.surfaceColorValue.value = elements.surfaceColor.value.toUpperCase();
      document.documentElement.style.setProperty("--custom-surface", elements.surfaceColor.value);
      syncThemeFromEnvironment();
      queueSettingsSave({ customSurface: elements.surfaceColor.value });
    });
    elements.themeTone.addEventListener("change", () => saveSettings({ themeTone: elements.themeTone.value }, true));
    elements.tabPreviewsToggle.addEventListener("change", () => {
      saveSettings({ showTabPreviews: elements.tabPreviewsToggle.checked }, false);
    });
    elements.workspaceOnlyToggle.addEventListener("change", () => saveSettings({ showCurrentWorkspaceOnly: elements.workspaceOnlyToggle.checked }, true));
    elements.pickAccentButton.addEventListener("click", () => pickScreenColor("customAccent"));
    elements.pickSurfaceButton.addEventListener("click", () => pickScreenColor("customSurface"));
    elements.supportDevelopmentButton.addEventListener("click", () => runAction(openSupportPage));
    elements.resetAppearanceButton.addEventListener("click", () => saveSettings({
      themeSource: "gx",
      themeTone: "auto",
      customAccent: State.DEFAULT_SETTINGS.customAccent,
      customSurface: State.DEFAULT_SETTINGS.customSurface
    }, true));
  }

  async function openSupportPage() {
    if (isExtension) {
      await extensionCall(chrome.tabs, "create", {
        active: true,
        url: SUPPORT_URL,
        windowId: model.windowId
      });
      return;
    }
    window.open(SUPPORT_URL, "_blank", "noopener,noreferrer");
  }

  function queueSettingsSave(changes) {
    model.pendingSettingsChanges = { ...model.pendingSettingsChanges, ...changes };
    clearTimeout(model.settingsSaveTimer);
    model.settingsSaveTimer = setTimeout(() => {
      const pending = model.pendingSettingsChanges;
      model.pendingSettingsChanges = {};
      saveSettings(pending, true);
    }, 120);
  }

  async function saveSettings(changes, shouldRender) {
    clearTimeout(model.settingsSaveTimer);
    model.settingsSaveTimer = null;
    if (Object.keys(model.pendingSettingsChanges).length) {
      changes = { ...model.pendingSettingsChanges, ...changes };
      model.pendingSettingsChanges = {};
    }
    const previous = model.state.settings;
    model.state.settings = State.normalizeSettings({ ...previous, ...changes });
    applySettingsToDocument();
    if (shouldRender) render();
    try {
      const response = await command("SETTINGS_UPDATE", { changes });
      if (response.state) model.state = State.normalizeState(response.state);
      applySettingsToDocument();
      if (shouldRender) render();
    } catch (error) {
      model.state.settings = previous;
      applySettingsToDocument();
      showToast(error.message);
    }
  }

  async function pickScreenColor(settingName) {
    if (typeof EyeDropper !== "function") {
      showToast("The eyedropper is unavailable in this Opera GX build");
      return;
    }
    try {
      const result = await new EyeDropper().open();
      await saveSettings({
        [settingName]: result.sRGBHex,
        themeSource: "custom"
      }, true);
      showToast(settingName === "customAccent" ? "Accent sampled" : "Surface sampled");
    } catch (error) {
      if (error && error.name !== "AbortError") showToast("Couldn't sample that color");
    }
  }

  function applySettingsToDocument() {
    const settings = model.state.settings;
    const root = document.documentElement;
    root.dataset.themeSource = settings.themeSource;
    root.dataset.density = settings.density;
    root.style.setProperty("--custom-accent", settings.customAccent);
    root.style.setProperty("--custom-surface", settings.customSurface);
    if (!settings.showTabPreviews) hideTabPreview(true);
    syncSettingsControls();
    syncThemeFromEnvironment();
  }

  function syncSettingsControls() {
    const settings = model.state.settings;
    document.querySelectorAll('input[name="themeSource"]').forEach((input) => {
      input.checked = input.value === settings.themeSource;
    });
    document.querySelectorAll('input[name="density"]').forEach((input) => {
      input.checked = input.value === settings.density;
    });
    elements.accentColor.value = settings.customAccent;
    elements.accentColorValue.value = settings.customAccent.toUpperCase();
    elements.surfaceColor.value = settings.customSurface;
    elements.surfaceColorValue.value = settings.customSurface.toUpperCase();
    elements.themeTone.value = settings.themeTone;
    elements.tabPreviewsToggle.checked = settings.showTabPreviews;
    elements.workspaceOnlyToggle.checked = settings.showCurrentWorkspaceOnly;
  }

  function syncThemeFromEnvironment() {
    const activeStyle = getComputedStyle(elements.activeThemeProbe);
    const surface = activeStyle.backgroundColor;
    const accent = activeStyle.color;
    const signature = `${surface}|${accent}|${model.state.settings.themeSource}|${model.state.settings.themeTone}`;
    if (signature !== model.themeSignature) {
      model.themeSignature = signature;
      const requestedTone = model.state.settings.themeTone;
      const tone = requestedTone === "auto" ? toneForColor(surface) : requestedTone;
      document.documentElement.dataset.tone = tone;
      requestAnimationFrame(refreshFaviconContrast);
    }
  }

  function toneForColor(value) {
    const numbers = String(value).match(/[\d.]+/g);
    if (!numbers || numbers.length < 3) {
      return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
    const [red, green, blue] = numbers.slice(0, 3).map(Number).map((channel) => {
      const normalized = channel / 255;
      return normalized <= .04045
        ? normalized / 12.92
        : Math.pow((normalized + .055) / 1.055, 2.4);
    });
    const luminance = .2126 * red + .7152 * green + .0722 * blue;
    return luminance > .42 ? "light" : "dark";
  }

  function showToast(message) {
    clearTimeout(model.toastTimer);
    elements.toastText.textContent = message;
    elements.toast.hidden = false;
    model.toastTimer = setTimeout(() => {
      elements.toast.hidden = true;
    }, 2600);
  }

  initialize().catch((error) => {
    console.error(error);
    elements.loadingState.hidden = true;
    showEmpty("Tab Deck couldn't start", error.message || "Reload the extension.");
  });
})();
