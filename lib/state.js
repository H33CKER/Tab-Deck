(function attachStateLibrary(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.GXTabState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createStateLibrary() {
  "use strict";

  const SCHEMA_VERSION = 6;
  // These keys are the native tab-group color IDs. Opera GX renders them in
  // this order, and the labels below describe the color Opera actually shows.
  // Keep this list in sync with the nine presets in Opera's own island picker.
  const DEFAULT_GROUP_COLORS = [
    "red",
    "yellow",
    "green",
    "pink",
    "purple",
    "cyan",
    "orange",
    "blue",
    "grey"
  ];
  const VALID_GROUP_COLORS = new Set(DEFAULT_GROUP_COLORS);
  const GROUP_COLOR_LABELS = Object.freeze({
    red: "Orange",
    yellow: "Yellow",
    green: "Grey",
    pink: "Purple",
    purple: "Blue",
    cyan: "Cyan",
    orange: "Green",
    blue: "Pink",
    grey: "Lime"
  });
  const LEGACY_GROUP_COLOR_ALIASES = Object.freeze({
    accent: "red",
    violet: "purple",
    amber: "yellow"
  });
  const VALID_THEME_SOURCES = new Set(["gx", "custom"]);
  const VALID_THEME_TONES = new Set(["auto", "dark", "light"]);
  const VALID_DENSITIES = new Set(["comfortable", "compact"]);

  const DEFAULT_SETTINGS = Object.freeze({
    themeSource: "gx",
    themeTone: "auto",
    customAccent: "#ff1b52",
    customSurface: "#17121f",
    density: "comfortable",
    showTabPreviews: true,
    showCurrentWorkspaceOnly: true
  });

  function createDefaultState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      nextGroupNumber: 1,
      groups: {},
      assignments: {},
      scopeOrders: {},
      nativeGroups: {},
      settings: { ...DEFAULT_SETTINGS }
    };
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function hasOwn(record, key) {
    return Boolean(record) && Object.prototype.hasOwnProperty.call(record, key);
  }

  function isSafeRecordKey(value) {
    return typeof value === "string" &&
      value.length > 0 &&
      value.length <= 200 &&
      !hasOwn(Object.prototype, value) &&
      value !== "__proto__" &&
      value !== "prototype" &&
      value !== "constructor";
  }

  function getGroup(state, groupId) {
    if (!state || !isPlainObject(state.groups) || !hasOwn(state.groups, groupId)) {
      return null;
    }
    return state.groups[groupId];
  }

  function normalizeBoolean(value, fallback) {
    return typeof value === "boolean" ? value : fallback;
  }

  function makeScopeKey(windowId, workspaceId) {
    const safeWindow = Number.isFinite(Number(windowId)) ? String(windowId) : "current";
    const safeWorkspace = workspaceId === undefined || workspaceId === null
      ? "default"
      : String(workspaceId);
    return `window:${safeWindow}|workspace:${safeWorkspace}`;
  }

  function makeGroupId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return `group-${crypto.randomUUID()}`;
    }

    const random = Math.random().toString(36).slice(2, 10);
    return `group-${Date.now().toString(36)}-${random}`;
  }

  function normalizeHexColor(value, fallback) {
    if (typeof value !== "string") return fallback;
    const color = value.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(color)) return color;
    if (/^#[0-9a-f]{3}$/.test(color)) {
      return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
    }
    return fallback;
  }

  function normalizeGroupColor(value, fallback) {
    const color = LEGACY_GROUP_COLOR_ALIASES[value] || value;
    return VALID_GROUP_COLORS.has(color) ? color : fallback;
  }

  function fallbackGroupName(number) {
    return `Group ${number}`;
  }

  function cleanGroupName(name) {
    if (typeof name !== "string" || !name.trim()) return "";
    return name.trim().slice(0, 80);
  }

  function normalizeSettings(input) {
    const settings = isPlainObject(input) ? input : {};
    return {
      themeSource: VALID_THEME_SOURCES.has(settings.themeSource)
        ? settings.themeSource
        : DEFAULT_SETTINGS.themeSource,
      themeTone: VALID_THEME_TONES.has(settings.themeTone)
        ? settings.themeTone
        : DEFAULT_SETTINGS.themeTone,
      customAccent: normalizeHexColor(
        settings.customAccent,
        DEFAULT_SETTINGS.customAccent
      ),
      customSurface: normalizeHexColor(
        settings.customSurface,
        DEFAULT_SETTINGS.customSurface
      ),
      density: VALID_DENSITIES.has(settings.density)
        ? settings.density
        : DEFAULT_SETTINGS.density,
      showTabPreviews: normalizeBoolean(
        settings.showTabPreviews,
        DEFAULT_SETTINGS.showTabPreviews
      ),
      showCurrentWorkspaceOnly: normalizeBoolean(
        settings.showCurrentWorkspaceOnly,
        DEFAULT_SETTINGS.showCurrentWorkspaceOnly
      )
    };
  }

  function normalizeState(input) {
    const source = isPlainObject(input) ? input : {};
    const output = createDefaultState();
    const sourceGroups = isPlainObject(source.groups) ? source.groups : {};
    const migrateGeneratedNames = !Number.isInteger(source.schemaVersion) || source.schemaVersion < 2;
    let highestNumber = 0;

    for (const [key, candidate] of Object.entries(sourceGroups)) {
      if (!isPlainObject(candidate)) continue;
      const id = typeof candidate.id === "string" && candidate.id ? candidate.id : key;
      if (!isSafeRecordKey(id)) continue;

      const number = Number.isInteger(candidate.number) && candidate.number > 0
        ? candidate.number
        : highestNumber + 1;
      highestNumber = Math.max(highestNumber, number);
      const scopeKey = isSafeRecordKey(candidate.scopeKey)
        ? candidate.scopeKey
        : makeScopeKey(candidate.windowId, candidate.workspaceId);

      const cleanedName = cleanGroupName(candidate.name);
      const name = migrateGeneratedNames && !candidate.customName && cleanedName === fallbackGroupName(number)
        ? ""
        : cleanedName;

      output.groups[id] = {
        id,
        number,
        name,
        customName: Boolean(candidate.customName && name),
        color: normalizeGroupColor(
          candidate.color,
          DEFAULT_GROUP_COLORS[(number - 1) % DEFAULT_GROUP_COLORS.length]
        ),
        collapsed: Boolean(candidate.collapsed),
        scopeKey,
        nativeGroupId: Number.isInteger(candidate.nativeGroupId)
          ? candidate.nativeGroupId
          : null,
        nativeWindowId: Number.isInteger(candidate.nativeWindowId)
          ? candidate.nativeWindowId
          : null,
        createdAt: Number.isFinite(candidate.createdAt) ? candidate.createdAt : Date.now(),
        updatedAt: Number.isFinite(candidate.updatedAt) ? candidate.updatedAt : Date.now()
      };
    }

    output.nextGroupNumber = highestNumber + 1;

    const sourceAssignments = isPlainObject(source.assignments) ? source.assignments : {};
    for (const [tabId, groupId] of Object.entries(sourceAssignments)) {
      const numericTabId = Number(tabId);
      if (
        Number.isInteger(numericTabId) &&
        numericTabId >= 0 &&
        isSafeRecordKey(groupId) &&
        hasOwn(output.groups, groupId)
      ) {
        output.assignments[String(numericTabId)] = groupId;
      }
    }

    const sourceOrders = isPlainObject(source.scopeOrders) ? source.scopeOrders : {};
    for (const [scopeKey, order] of Object.entries(sourceOrders)) {
      if (!isSafeRecordKey(scopeKey) || !Array.isArray(order)) continue;
      output.scopeOrders[scopeKey] = [...new Set(order)].filter((groupId) => {
        const group = getGroup(output, groupId);
        return group && group.scopeKey === scopeKey;
      });
    }

    for (const group of Object.values(output.groups)) {
      if (!output.scopeOrders[group.scopeKey]) output.scopeOrders[group.scopeKey] = [];
      if (!output.scopeOrders[group.scopeKey].includes(group.id)) {
        output.scopeOrders[group.scopeKey].push(group.id);
      }
    }

    const sourceNativeGroups = isPlainObject(source.nativeGroups) ? source.nativeGroups : {};
    for (const [nativeKey, groupId] of Object.entries(sourceNativeGroups)) {
      if (/^-?\d+:-?\d+$/.test(nativeKey) && getGroup(output, groupId)) {
        output.nativeGroups[nativeKey] = groupId;
      }
    }

    output.settings = normalizeSettings(source.settings);
    return output;
  }

  function createGroup(state, options) {
    const settings = isPlainObject(options) ? options : {};
    const number = state.nextGroupNumber;
    state.nextGroupNumber += 1;
    const id = makeGroupId();
    const customName = typeof settings.name === "string" && Boolean(settings.name.trim());
    const scopeKey = isSafeRecordKey(settings.scopeKey)
      ? settings.scopeKey
      : makeScopeKey(settings.windowId, settings.workspaceId);
    const group = {
      id,
      number,
      name: cleanGroupName(settings.name),
      customName,
      color: normalizeGroupColor(
        settings.color,
        DEFAULT_GROUP_COLORS[(number - 1) % DEFAULT_GROUP_COLORS.length]
      ),
      collapsed: false,
      scopeKey,
      nativeGroupId: Number.isInteger(settings.nativeGroupId) ? settings.nativeGroupId : null,
      nativeWindowId: Number.isInteger(settings.nativeWindowId) ? settings.nativeWindowId : null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    state.groups[id] = group;
    if (!state.scopeOrders[scopeKey]) state.scopeOrders[scopeKey] = [];
    state.scopeOrders[scopeKey].push(id);
    return group;
  }

  function renameGroup(state, groupId, name) {
    const group = getGroup(state, groupId);
    if (!group) return null;
    const hasName = typeof name === "string" && Boolean(name.trim());
    group.name = cleanGroupName(name);
    group.customName = hasName;
    group.updatedAt = Date.now();
    return group;
  }

  function setGroupScope(state, groupId, scopeKey) {
    const group = getGroup(state, groupId);
    if (!group || !isSafeRecordKey(scopeKey) || group.scopeKey === scopeKey) {
      return group || null;
    }

    const oldOrder = state.scopeOrders[group.scopeKey] || [];
    state.scopeOrders[group.scopeKey] = oldOrder.filter((id) => id !== groupId);
    if (!state.scopeOrders[group.scopeKey].length) delete state.scopeOrders[group.scopeKey];
    if (!state.scopeOrders[scopeKey]) state.scopeOrders[scopeKey] = [];
    if (!state.scopeOrders[scopeKey].includes(groupId)) state.scopeOrders[scopeKey].push(groupId);
    group.scopeKey = scopeKey;
    group.updatedAt = Date.now();
    return group;
  }

  function assignTabs(state, groupId, tabIds) {
    const group = getGroup(state, groupId);
    if (!group || !Array.isArray(tabIds)) return false;
    let changed = false;
    for (const tabId of tabIds) {
      const numericTabId = Number(tabId);
      if (!Number.isInteger(numericTabId) || numericTabId < 0) continue;
      const key = String(numericTabId);
      if (state.assignments[key] !== groupId) {
        state.assignments[key] = groupId;
        changed = true;
      }
    }
    if (changed) group.updatedAt = Date.now();
    return changed;
  }

  function unassignTabs(state, tabIds) {
    if (!Array.isArray(tabIds)) return false;
    let changed = false;
    for (const tabId of tabIds) {
      const key = String(tabId);
      if (Object.prototype.hasOwnProperty.call(state.assignments, key)) {
        delete state.assignments[key];
        changed = true;
      }
    }
    return changed;
  }

  function listGroupTabIds(state, groupId) {
    return Object.entries(state.assignments)
      .filter(([, assignedGroupId]) => assignedGroupId === groupId)
      .map(([tabId]) => Number(tabId))
      .filter((tabId) => Number.isInteger(tabId) && tabId >= 0);
  }

  function deleteGroup(state, groupId) {
    const group = getGroup(state, groupId);
    if (!group) return [];
    const tabIds = listGroupTabIds(state, groupId);
    unassignTabs(state, tabIds);
    delete state.groups[groupId];

    for (const [scopeKey, order] of Object.entries(state.scopeOrders)) {
      state.scopeOrders[scopeKey] = order.filter((id) => id !== groupId);
      if (!state.scopeOrders[scopeKey].length) delete state.scopeOrders[scopeKey];
    }

    for (const [nativeKey, mappedGroupId] of Object.entries(state.nativeGroups)) {
      if (mappedGroupId === groupId) delete state.nativeGroups[nativeKey];
    }

    const highestRemainingNumber = Object.values(state.groups).reduce((highest, candidate) => {
      return Number.isInteger(candidate.number) && candidate.number > highest
        ? candidate.number
        : highest;
    }, 0);
    state.nextGroupNumber = highestRemainingNumber + 1;
    return tabIds;
  }

  function reorderGroups(state, scopeKey, orderedIds) {
    if (!isSafeRecordKey(scopeKey) || !Array.isArray(orderedIds)) return [];
    const current = state.scopeOrders[scopeKey] || [];
    const valid = [...new Set(orderedIds)].filter((groupId) => {
      const group = getGroup(state, groupId);
      return group && group.scopeKey === scopeKey;
    });
    const scopedIds = Object.values(state.groups)
      .filter((group) => group.scopeKey === scopeKey)
      .map((group) => group.id);
    const missing = [...new Set([...current, ...scopedIds])]
      .filter((groupId) => !valid.includes(groupId) && getGroup(state, groupId));
    state.scopeOrders[scopeKey] = [...valid, ...missing];
    return state.scopeOrders[scopeKey];
  }

  function groupHasTabs(state, groupId) {
    return Object.values(state.assignments).includes(groupId);
  }

  return Object.freeze({
    SCHEMA_VERSION,
    DEFAULT_SETTINGS,
    DEFAULT_GROUP_COLORS,
    GROUP_COLOR_LABELS,
    VALID_GROUP_COLORS,
    createDefaultState,
    normalizeState,
    normalizeSettings,
    normalizeHexColor,
    makeScopeKey,
    fallbackGroupName,
    cleanGroupName,
    createGroup,
    renameGroup,
    setGroupScope,
    assignTabs,
    unassignTabs,
    listGroupTabIds,
    deleteGroup,
    reorderGroups,
    groupHasTabs
  });
});
