"use strict";

importScripts("lib/state.js");

const STORAGE_KEY = "gxTabDeckState";
const TAB_GROUP_VALUE_KEY = "gxTabDeck.groupId";
const NONE_GROUP_ID = -1;
const State = globalThis.GXTabState;
const DEFAULT_NATIVE_GROUP_COLOR = "grey";
const TAB_PREVIEW_CACHE_LIMIT = 18;
const TAB_PREVIEW_FRESH_MS = 12000;
const tabPreviewCache = new Map();
const tabPreviewCaptureTimers = new Map();
const tabPreviewCaptures = new Map();

function nativeGroupColor(value) {
  return State.VALID_GROUP_COLORS.has(value) ? value : DEFAULT_NATIVE_GROUP_COLOR;
}

let operationQueue = Promise.resolve();

function enqueue(task) {
  const next = operationQueue.then(task, task);
  operationQueue = next.catch(() => undefined);
  return next;
}

function chromeCall(namespace, method, ...args) {
  return new Promise((resolve, reject) => {
    if (!namespace || typeof namespace[method] !== "function") {
      reject(new Error(`${method} is not supported by this Opera build`));
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

function tabUrl(tab) {
  return tab && (tab.pendingUrl || tab.url) || "";
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

function tabSplitViewId(tab) {
  if (!tab || typeof tab !== "object") return null;
  for (const value of [tab.splitViewId, tab.splitScreenId]) {
    if (Number.isInteger(value) && value >= 0) return value;
  }
  return null;
}

function cachedTabPreview(tab) {
  if (!tab || !Number.isInteger(tab.id)) return null;
  const entry = tabPreviewCache.get(tab.id);
  if (!entry) return null;
  if (entry.url !== tabUrl(tab)) {
    tabPreviewCache.delete(tab.id);
    return null;
  }
  tabPreviewCache.delete(tab.id);
  tabPreviewCache.set(tab.id, entry);
  return entry;
}

function storeTabPreview(tabIds, entry) {
  for (const tabId of tabIds) {
    if (!Number.isInteger(tabId)) continue;
    tabPreviewCache.delete(tabId);
    tabPreviewCache.set(tabId, entry);
  }
  while (tabPreviewCache.size > TAB_PREVIEW_CACHE_LIMIT) {
    const oldestTabId = tabPreviewCache.keys().next().value;
    tabPreviewCache.delete(oldestTabId);
  }
}

function removeTabPreview(tabId) {
  tabPreviewCache.delete(tabId);
  const timer = tabPreviewCaptureTimers.get(tabId);
  if (timer) clearTimeout(timer);
  tabPreviewCaptureTimers.delete(tabId);
}

function previewPayload(entry, reason, detailsOnly) {
  return {
    thumbnail: entry ? entry.thumbnail : "",
    url: entry ? entry.url : "",
    capturedAt: entry ? entry.capturedAt : 0,
    reason: reason || "",
    detailsOnly: Boolean(detailsOnly)
  };
}

async function captureActiveTabPreview(tab) {
  if (!tab || !Number.isInteger(tab.id) || !Number.isInteger(tab.windowId)) return null;
  if (!chrome.tabs || typeof chrome.tabs.captureVisibleTab !== "function") return null;
  if (!supportsScreenPreview(tabUrl(tab))) return null;

  const cached = cachedTabPreview(tab);
  if (cached && Date.now() - cached.capturedAt < TAB_PREVIEW_FRESH_MS) return cached;
  if (!tab.active) return cached;
  if (tabPreviewCaptures.has(tab.windowId)) {
    await tabPreviewCaptures.get(tab.windowId);
    return cachedTabPreview(tab);
  }

  const capture = (async () => {
    const activeTabs = await chromeCall(chrome.tabs, "query", {
      active: true,
      windowId: tab.windowId
    });
    const activeTab = activeTabs && activeTabs[0];
    if (!activeTab || activeTab.id !== tab.id) return null;

    const thumbnail = await chromeCall(chrome.tabs, "captureVisibleTab", tab.windowId, {
      format: "jpeg",
      quality: 42
    });
    if (typeof thumbnail !== "string" || !thumbnail.startsWith("data:image/")) return null;

    const currentTabs = await chromeCall(chrome.tabs, "query", {
      active: true,
      windowId: tab.windowId
    });
    const currentTab = currentTabs && currentTabs[0];
    if (!currentTab || currentTab.id !== tab.id) return null;

    const entry = {
      thumbnail,
      url: tabUrl(currentTab),
      capturedAt: Date.now()
    };
    let previewTabs = [currentTab];
    const splitViewId = tabSplitViewId(currentTab);
    if (splitViewId !== null) {
      const windowTabs = await chromeCall(chrome.tabs, "query", { windowId: tab.windowId });
      previewTabs = windowTabs.filter((candidate) => tabSplitViewId(candidate) === splitViewId);
    }
    for (const previewTab of previewTabs) {
      storeTabPreview([previewTab.id], {
        ...entry,
        url: tabUrl(previewTab)
      });
    }
    return entry;
  })();

  tabPreviewCaptures.set(tab.windowId, capture);
  try {
    return await capture;
  } finally {
    tabPreviewCaptures.delete(tab.windowId);
  }
}

async function getTabPreview(payload) {
  const tabId = Number(payload && payload.tabId);
  if (!Number.isInteger(tabId) || tabId < 0) {
    return previewPayload(null, "Invalid tab");
  }

  let tab;
  try {
    tab = await chromeCall(chrome.tabs, "get", tabId);
  } catch (_error) {
    removeTabPreview(tabId);
    return previewPayload(null, "Tab is no longer open");
  }

  if (!supportsScreenPreview(tabUrl(tab))) {
    removeTabPreview(tabId);
    return previewPayload(null, "", true);
  }

  let entry = cachedTabPreview(tab);
  if (tab.active) {
    try {
      entry = await captureActiveTabPreview(tab) || entry;
    } catch (_error) {
      // Restricted browser pages cannot be captured; a prior local image can
      // still be returned when one exists.
    }
  }
  return previewPayload(
    entry,
    entry ? "" : (tab.active ? "" : "Open this tab to capture a preview"),
    Boolean(tab.active && !entry)
  );
}

function scheduleTabPreviewCapture(tabId, delay) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  const previous = tabPreviewCaptureTimers.get(tabId);
  if (previous) clearTimeout(previous);
  const timer = setTimeout(async () => {
    tabPreviewCaptureTimers.delete(tabId);
    try {
      const tab = await chromeCall(chrome.tabs, "get", tabId);
      if (tab && tab.active) await captureActiveTabPreview(tab);
    } catch (_error) {
      // The tab may close or navigate to an uncapturable browser page.
    }
  }, delay === undefined ? 220 : delay);
  tabPreviewCaptureTimers.set(tabId, timer);
}

async function loadState() {
  const stored = await chromeCall(chrome.storage.local, "get", STORAGE_KEY);
  return State.normalizeState(stored && stored[STORAGE_KEY]);
}

async function saveState(state) {
  await chromeCall(chrome.storage.local, "set", { [STORAGE_KEY]: state });
}

function notifyPanels(reason) {
  try {
    chrome.runtime.sendMessage({ type: "GX_TAB_DECK_CHANGED", reason }, () => {
      void chrome.runtime.lastError;
    });
  } catch (_error) {
    // There may be no open sidebar, which is expected.
  }
}

function nativeKey(windowId, nativeGroupId) {
  return `${windowId}:${nativeGroupId}`;
}

function tabScope(tab) {
  return State.makeScopeKey(tab.windowId, tab.workspaceId);
}

function validTabIds(tabIds) {
  if (!Array.isArray(tabIds)) return [];
  return [...new Set(tabIds.map(Number).filter((tabId) => Number.isInteger(tabId) && tabId >= 0))];
}

function getLocalGroup(state, groupId) {
  if (
    !state ||
    !state.groups ||
    !Object.prototype.hasOwnProperty.call(state.groups, groupId)
  ) {
    return null;
  }
  return state.groups[groupId];
}

function hasNativeGroup(tab) {
  return Number.isInteger(tab && tab.groupId) && tab.groupId !== NONE_GROUP_ID;
}

async function setSessionGroup(tabId, groupId) {
  if (!chrome.sessions || typeof chrome.sessions.setTabValue !== "function") return;
  try {
    await chromeCall(chrome.sessions, "setTabValue", tabId, TAB_GROUP_VALUE_KEY, groupId);
  } catch (_error) {
    // Session tab values are an enhancement; storage remains the fallback.
  }
}

async function getSessionGroup(tabId) {
  if (!chrome.sessions || typeof chrome.sessions.getTabValue !== "function") return null;
  try {
    const value = await chromeCall(chrome.sessions, "getTabValue", tabId, TAB_GROUP_VALUE_KEY);
    return typeof value === "string" ? value : null;
  } catch (_error) {
    return null;
  }
}

async function removeSessionGroup(tabId) {
  if (!chrome.sessions || typeof chrome.sessions.removeTabValue !== "function") return;
  try {
    await chromeCall(chrome.sessions, "removeTabValue", tabId, TAB_GROUP_VALUE_KEY);
  } catch (_error) {
    // A tab may already be gone.
  }
}

async function persistAssignments(state, tabIds) {
  await Promise.all(tabIds.map((tabId) => {
    const groupId = state.assignments[String(tabId)];
    return groupId ? setSessionGroup(tabId, groupId) : removeSessionGroup(tabId);
  }));
}

async function getNativeGroup(nativeGroupId) {
  if (!chrome.tabGroups || typeof chrome.tabGroups.get !== "function") return null;
  try {
    return await chromeCall(chrome.tabGroups, "get", nativeGroupId);
  } catch (_error) {
    return null;
  }
}

async function updateNativeGroup(group, changes) {
  if (!group || !Number.isInteger(group.nativeGroupId)) return null;
  if (!chrome.tabGroups || typeof chrome.tabGroups.update !== "function") return null;

  try {
    return await chromeCall(chrome.tabGroups, "update", group.nativeGroupId, changes);
  } catch (_error) {
    return null;
  }
}

async function getGroupableTabs(tabIds) {
  const tabs = await Promise.all(validTabIds(tabIds).map(async (tabId) => {
    try {
      return await chromeCall(chrome.tabs, "get", tabId);
    } catch (_error) {
      return null;
    }
  }));
  return tabs.filter((tab) => tab && Number.isInteger(tab.id) && !tab.pinned);
}

function clearNativeGroupReference(state, group) {
  if (!group) return;
  for (const [key, mappedGroupId] of Object.entries(state.nativeGroups)) {
    if (mappedGroupId === group.id) delete state.nativeGroups[key];
  }
  group.nativeGroupId = null;
  group.nativeWindowId = null;
}

function rememberNativeGroup(state, group, nativeGroupId, windowId) {
  for (const [key, mappedGroupId] of Object.entries(state.nativeGroups)) {
    if (mappedGroupId === group.id) delete state.nativeGroups[key];
  }
  group.nativeGroupId = nativeGroupId;
  group.nativeWindowId = windowId;
  state.nativeGroups[nativeKey(windowId, nativeGroupId)] = group.id;
}

async function tryCreateNativeGroup(state, tabs, group) {
  if (tabs.length < 2 || !chrome.tabs || typeof chrome.tabs.group !== "function") {
    return null;
  }

  const windowId = tabs[0].windowId;
  if (!Number.isInteger(windowId) || tabs.some((tab) => tab.windowId !== windowId)) return null;
  const tabIds = tabs.map((tab) => tab.id);

  try {
    const nativeGroupId = await chromeCall(chrome.tabs, "group", { tabIds });
    rememberNativeGroup(state, group, nativeGroupId, windowId);
    await updateNativeGroup(group, {
      title: group.name || "",
      color: nativeGroupColor(group.color),
      collapsed: group.collapsed
    });
    return nativeGroupId;
  } catch (_error) {
    // Opera GX currently rejects tab grouping in some builds. The local island
    // remains fully functional in the extension sidebar.
    return null;
  }
}

async function tryAssignNativeGroup(tabIds, group) {
  if (!tabIds.length || !group || !Number.isInteger(group.nativeGroupId)) return false;
  if (!chrome.tabs || typeof chrome.tabs.group !== "function") return false;
  try {
    await chromeCall(chrome.tabs, "group", {
      tabIds,
      groupId: group.nativeGroupId
    });
    return true;
  } catch (_error) {
    return false;
  }
}

async function syncGroupToNative(state, groupId) {
  const group = getLocalGroup(state, groupId);
  if (!group) return null;
  const tabs = await getGroupableTabs(State.listGroupTabIds(state, groupId));
  const tabIds = tabs.map((tab) => tab.id);

  if (Number.isInteger(group.nativeGroupId)) {
    const sameWindow = tabs.every((tab) => tab.windowId === group.nativeWindowId);
    if (sameWindow && await tryAssignNativeGroup(tabIds, group)) {
      if (tabs[0]) rememberNativeGroup(
        state,
        group,
        group.nativeGroupId,
        tabs[0].windowId
      );
      return group.nativeGroupId;
    }
    clearNativeGroupReference(state, group);
  }

  return tryCreateNativeGroup(state, tabs, group);
}

async function syncAllGroupsToNative(state) {
  for (const groupId of Object.keys(state.groups)) {
    await syncGroupToNative(state, groupId);
  }
}

async function tryUngroupNativeTabs(tabIds) {
  if (!tabIds.length || !chrome.tabs || typeof chrome.tabs.ungroup !== "function") return;
  try {
    await chromeCall(chrome.tabs, "ungroup", tabIds);
  } catch (_error) {
    // Local grouping still works if Opera's native Tab Islands API is blocked.
  }
}

function pruneEmptyGroups(state, groupIds) {
  for (const groupId of new Set(groupIds.filter(Boolean))) {
    if (getLocalGroup(state, groupId) && !State.groupHasTabs(state, groupId)) {
      State.deleteGroup(state, groupId);
    }
  }
}

async function reconcileStateWithTabs(state, tabs) {
  const before = JSON.stringify(state);
  const pinnedAssignments = tabs
    .filter((tab) => tab.pinned && state.assignments[String(tab.id)])
    .map((tab) => tab.id);
  const pinnedGroups = pinnedAssignments.map((tabId) => state.assignments[String(tabId)]);
  if (pinnedAssignments.length) {
    State.unassignTabs(state, pinnedAssignments);
    pruneEmptyGroups(state, pinnedGroups);
    await persistAssignments(state, pinnedAssignments);
  }

  const unresolvedTabs = tabs.filter((tab) => !tab.pinned && (() => {
    const assigned = state.assignments[String(tab.id)];
    return !assigned || !getLocalGroup(state, assigned);
  })());

  const sessionAssignments = await Promise.all(unresolvedTabs.map(async (tab) => {
    return [tab, await getSessionGroup(tab.id)];
  }));

  for (const [tab, groupId] of sessionAssignments) {
    if (!groupId || !getLocalGroup(state, groupId)) continue;
    State.assignTabs(state, groupId, [tab.id]);
    const group = getLocalGroup(state, groupId);
    if (group && group.scopeKey !== tabScope(tab)) {
      State.setGroupScope(state, groupId, tabScope(tab));
    }
  }

  const nativeBuckets = new Map();
  for (const tab of tabs) {
    if (!hasNativeGroup(tab)) continue;
    const key = nativeKey(tab.windowId, tab.groupId);
    if (!nativeBuckets.has(key)) nativeBuckets.set(key, []);
    nativeBuckets.get(key).push(tab);
  }

  for (const [key, nativeTabs] of nativeBuckets) {
    const nativeGroupId = nativeTabs[0].groupId;
    let localGroupId = state.nativeGroups[key];

    if (!getLocalGroup(state, localGroupId)) {
      localGroupId = nativeTabs
        .map((tab) => state.assignments[String(tab.id)])
        .find((groupId) => getLocalGroup(state, groupId));
    }

    const nativeDetails = await getNativeGroup(nativeGroupId);
    if (!getLocalGroup(state, localGroupId)) {
      const group = State.createGroup(state, {
        scopeKey: tabScope(nativeTabs[0]),
        name: nativeDetails && nativeDetails.title,
        color: nativeDetails && State.VALID_GROUP_COLORS.has(nativeDetails.color)
          ? nativeDetails.color
          : undefined,
        nativeGroupId,
        nativeWindowId: nativeTabs[0].windowId
      });
      group.customName = false;
      localGroupId = group.id;
    }

    const group = getLocalGroup(state, localGroupId);
    rememberNativeGroup(state, group, nativeGroupId, nativeTabs[0].windowId);
    if (group.scopeKey !== tabScope(nativeTabs[0])) {
      State.setGroupScope(state, group.id, tabScope(nativeTabs[0]));
    }
    if (nativeDetails && typeof nativeDetails.title === "string" && !group.customName) {
      group.name = State.cleanGroupName(nativeDetails.title);
    }
    if (nativeDetails && State.VALID_GROUP_COLORS.has(nativeDetails.color)) {
      group.color = nativeDetails.color;
    }
    if (nativeDetails && typeof nativeDetails.collapsed === "boolean") {
      group.collapsed = nativeDetails.collapsed;
    }

    const reassigned = nativeTabs
      .filter((tab) => state.assignments[String(tab.id)] !== localGroupId)
      .map((tab) => tab.id);
    const previousGroups = reassigned.map((tabId) => state.assignments[String(tabId)]);
    State.assignTabs(state, localGroupId, reassigned);
    pruneEmptyGroups(state, previousGroups.filter((groupId) => groupId !== localGroupId));
    await persistAssignments(state, reassigned);
  }

  const nativelyUngroupedTabIds = [];
  const nativelyUngroupedLocalGroups = [];
  for (const tab of tabs) {
    if (!tab || tab.pinned || hasNativeGroup(tab) || !Number.isInteger(tab.id)) continue;
    const localGroupId = state.assignments[String(tab.id)];
    const localGroup = getLocalGroup(state, localGroupId);
    if (!localGroup || !Number.isInteger(localGroup.nativeGroupId)) continue;
    nativelyUngroupedTabIds.push(tab.id);
    nativelyUngroupedLocalGroups.push(localGroupId);
  }

  if (nativelyUngroupedTabIds.length) {
    State.unassignTabs(state, nativelyUngroupedTabIds);
    pruneEmptyGroups(state, nativelyUngroupedLocalGroups);
    await persistAssignments(state, nativelyUngroupedTabIds);
  }

  const queriedWindowIds = new Set(tabs.map((tab) => tab.windowId).filter(Number.isInteger));
  for (const group of Object.values(state.groups)) {
    if (!Number.isInteger(group.nativeGroupId) || !queriedWindowIds.has(group.nativeWindowId)) continue;
    if (!nativeBuckets.has(nativeKey(group.nativeWindowId, group.nativeGroupId))) {
      clearNativeGroupReference(state, group);
    }
  }

  return before !== JSON.stringify(state);
}

async function initializeForWindow(windowId) {
  const state = await loadState();
  const query = Number.isInteger(windowId) ? { windowId } : { currentWindow: true };
  const tabs = await chromeCall(chrome.tabs, "query", query);
  const changed = await reconcileStateWithTabs(state, tabs);
  if (changed) await saveState(state);
  return { state, tabs };
}

async function createGroupFromMessage(state, payload) {
  const tabIds = (await getGroupableTabs(payload.tabIds)).map((tab) => tab.id);
  let scopeKey = typeof payload.scopeKey === "string" ? payload.scopeKey : null;
  if (!scopeKey && tabIds.length) {
    try {
      const tab = await chromeCall(chrome.tabs, "get", tabIds[0]);
      scopeKey = tabScope(tab);
    } catch (_error) {
      scopeKey = State.makeScopeKey(payload.windowId, payload.workspaceId);
    }
  }
  scopeKey ||= State.makeScopeKey(payload.windowId, payload.workspaceId);

  const previousGroups = tabIds.map((tabId) => state.assignments[String(tabId)]);
  const group = State.createGroup(state, {
    scopeKey,
    name: payload.name,
    color: payload.color
  });

  State.assignTabs(state, group.id, tabIds);
  await syncGroupToNative(state, group.id);
  pruneEmptyGroups(state, previousGroups);
  await persistAssignments(state, tabIds);
  return group;
}

async function handleMessage(message) {
  const type = message && message.type;
  const payload = message && message.payload ? message.payload : {};

  if (type === "TAB_PREVIEW_GET") {
    return getTabPreview(payload);
  }

  if (type === "INIT") {
    return initializeForWindow(Number(payload.windowId));
  }

  const state = await loadState();
  let result = null;

  switch (type) {
    case "GROUP_CREATE": {
      const group = await createGroupFromMessage(state, payload);
      result = { groupId: group.id };
      break;
    }

    case "GROUP_RENAME": {
      const group = State.renameGroup(state, payload.groupId, payload.name);
      if (!group) throw new Error("Island not found");
      await updateNativeGroup(group, { title: group.name || "" });
      result = { groupId: group.id, name: group.name };
      break;
    }

    case "GROUP_TOGGLE": {
      const group = getLocalGroup(state, payload.groupId);
      if (!group) throw new Error("Island not found");
      group.collapsed = typeof payload.collapsed === "boolean"
        ? payload.collapsed
        : !group.collapsed;
      group.updatedAt = Date.now();
      await updateNativeGroup(group, { collapsed: group.collapsed });
      result = { groupId: group.id, collapsed: group.collapsed };
      break;
    }

    case "GROUP_COLOR": {
      const group = getLocalGroup(state, payload.groupId);
      if (!group) throw new Error("Island not found");
      if (!State.VALID_GROUP_COLORS.has(payload.color)) throw new Error("Unknown island color");
      group.color = payload.color;
      group.updatedAt = Date.now();
      await updateNativeGroup(group, {
        color: nativeGroupColor(group.color)
      });
      result = { groupId: group.id, color: group.color };
      break;
    }

    case "GROUP_ASSIGN": {
      const group = getLocalGroup(state, payload.groupId);
      if (!group) throw new Error("Island not found");
      const tabIds = (await getGroupableTabs(payload.tabIds)).map((tab) => tab.id);
      const previousGroups = tabIds.map((tabId) => state.assignments[String(tabId)]);
      State.assignTabs(state, group.id, tabIds);
      await syncGroupToNative(state, group.id);
      pruneEmptyGroups(state, previousGroups.filter((id) => id !== group.id));
      await persistAssignments(state, tabIds);
      result = { groupId: group.id, tabIds };
      break;
    }

    case "TAB_UNASSIGN": {
      const tabIds = validTabIds(payload.tabIds);
      const previousGroups = tabIds.map((tabId) => state.assignments[String(tabId)]);
      State.unassignTabs(state, tabIds);
      await tryUngroupNativeTabs(tabIds);
      pruneEmptyGroups(state, previousGroups);
      await persistAssignments(state, tabIds);
      result = { tabIds };
      break;
    }

    case "GROUP_DELETE": {
      const group = getLocalGroup(state, payload.groupId);
      if (!group) throw new Error("Island not found");
      const tabIds = State.listGroupTabIds(state, group.id);
      await tryUngroupNativeTabs(tabIds);
      State.deleteGroup(state, group.id);
      await persistAssignments(state, tabIds);
      result = { tabIds };
      break;
    }

    case "GROUP_CLOSE": {
      const group = getLocalGroup(state, payload.groupId);
      if (!group) throw new Error("Island not found");
      const tabIds = State.listGroupTabIds(state, group.id);
      if (tabIds.length) await chromeCall(chrome.tabs, "remove", tabIds);
      State.deleteGroup(state, group.id);
      result = { tabIds };
      break;
    }

    case "GROUP_REORDER": {
      result = {
        order: State.reorderGroups(state, payload.scopeKey, payload.orderedIds)
      };
      break;
    }

    case "SETTINGS_UPDATE": {
      state.settings = State.normalizeSettings({
        ...state.settings,
        ...(payload.changes || {})
      });
      result = { settings: state.settings };
      break;
    }

    default:
      throw new Error(`Unknown command: ${String(type)}`);
  }

  await saveState(state);
  notifyPanels(type);
  return { state, ...result };
}

const MESSAGE_TYPES = new Set([
  "INIT",
  "TAB_PREVIEW_GET",
  "GROUP_CREATE",
  "GROUP_RENAME",
  "GROUP_TOGGLE",
  "GROUP_COLOR",
  "GROUP_ASSIGN",
  "TAB_UNASSIGN",
  "GROUP_DELETE",
  "GROUP_CLOSE",
  "GROUP_REORDER",
  "SETTINGS_UPDATE"
]);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !MESSAGE_TYPES.has(message.type)) return undefined;

  enqueue(() => handleMessage(message))
    .then((response) => sendResponse({ ok: true, ...response }))
    .catch((error) => {
      console.error("Tab Deck command failed", message.type, error);
      sendResponse({ ok: false, error: error.message || String(error) });
    });
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  enqueue(async () => {
    const state = await loadState();
    const tabs = await chromeCall(chrome.tabs, "query", {});
    await reconcileStateWithTabs(state, tabs);
    await syncAllGroupsToNative(state);
    await saveState(state);
  }).catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  enqueue(async () => {
    const state = await loadState();
    const tabs = await chromeCall(chrome.tabs, "query", {});
    const validIds = new Set(tabs.map((tab) => String(tab.id)));
    const possiblyEmpty = [];

    for (const [tabId, groupId] of Object.entries(state.assignments)) {
      if (!validIds.has(tabId)) {
        delete state.assignments[tabId];
        possiblyEmpty.push(groupId);
      }
    }

    await reconcileStateWithTabs(state, tabs);
    await syncAllGroupsToNative(state);
    pruneEmptyGroups(state, possiblyEmpty);
    await saveState(state);
    notifyPanels("startup");
  }).catch(console.error);
});

chrome.tabs.onCreated.addListener(() => notifyPanels("tab-created"));

chrome.tabs.onRemoved.addListener((tabId) => {
  removeTabPreview(tabId);
  enqueue(async () => {
    const state = await loadState();
    const groupId = state.assignments[String(tabId)];
    if (groupId) {
      State.unassignTabs(state, [tabId]);
      pruneEmptyGroups(state, [groupId]);
      await saveState(state);
    }
    notifyPanels("tab-removed");
  }).catch(console.error);
});

if (chrome.tabs.onReplaced) {
  chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    removeTabPreview(removedTabId);
    scheduleTabPreviewCapture(addedTabId, 260);
    enqueue(async () => {
      const state = await loadState();
      const groupId = state.assignments[String(removedTabId)];
      if (groupId && getLocalGroup(state, groupId)) {
        State.unassignTabs(state, [removedTabId]);
        State.assignTabs(state, groupId, [addedTabId]);
        await setSessionGroup(addedTabId, groupId);
        await syncGroupToNative(state, groupId);
        await saveState(state);
      }
      notifyPanels("tab-replaced");
    }).catch(console.error);
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo &&
    (
      typeof changeInfo.url === "string" ||
      changeInfo.status === "loading" ||
      Object.prototype.hasOwnProperty.call(changeInfo, "splitViewId")
    )
  ) {
    removeTabPreview(tabId);
  }
  if (
    tab &&
    tab.active &&
    changeInfo &&
    (
      changeInfo.status === "complete" ||
      Object.prototype.hasOwnProperty.call(changeInfo, "splitViewId")
    )
  ) {
    scheduleTabPreviewCapture(tabId, 260);
  }
  if (!changeInfo || changeInfo.pinned !== true) {
    notifyPanels("onUpdated");
    return;
  }

  enqueue(async () => {
    const state = await loadState();
    const groupId = state.assignments[String(tabId)];
    if (groupId) {
      State.unassignTabs(state, [tabId]);
      await tryUngroupNativeTabs([tabId]);
      pruneEmptyGroups(state, [groupId]);
      await removeSessionGroup(tabId);
      await saveState(state);
    }
    notifyPanels(tab && tab.pinned ? "tab-pinned" : "onUpdated");
  }).catch(console.error);
});

if (chrome.tabs.onActivated) {
  chrome.tabs.onActivated.addListener((activeInfo) => {
    notifyPanels("onActivated");
    if (activeInfo && Number.isInteger(activeInfo.tabId)) {
      scheduleTabPreviewCapture(activeInfo.tabId, 220);
    }
  });
}

for (const eventName of ["onMoved", "onAttached", "onDetached"]) {
  const event = chrome.tabs[eventName];
  if (event && typeof event.addListener === "function") {
    event.addListener(() => notifyPanels(eventName));
  }
}

if (chrome.tabGroups) {
  for (const eventName of ["onCreated", "onUpdated", "onMoved", "onRemoved"]) {
    const event = chrome.tabGroups[eventName];
    if (event && typeof event.addListener === "function") {
      event.addListener(() => notifyPanels(`tabGroups.${eventName}`));
    }
  }
}
