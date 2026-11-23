(function attachInteractionLibrary(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.GXTabInteractions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createInteractionLibrary() {
  "use strict";

  function moveItemRelative(items, movingItem, targetItem, placeAfter) {
    if (!Array.isArray(items)) return [];
    const order = [...new Set(items)];
    if (
      movingItem === targetItem ||
      !order.includes(movingItem) ||
      !order.includes(targetItem)
    ) {
      return order;
    }

    const next = order.filter((item) => item !== movingItem);
    const targetIndex = next.indexOf(targetItem);
    next.splice(targetIndex + (placeAfter ? 1 : 0), 0, movingItem);
    return next;
  }

  function tabDropIndex(sourceIndex, targetIndex, placeAfter) {
    if (
      !Number.isInteger(sourceIndex) ||
      !Number.isInteger(targetIndex) ||
      sourceIndex < 0 ||
      targetIndex < 0
    ) {
      return null;
    }
    if (sourceIndex === targetIndex) return sourceIndex;

    const requestedIndex = targetIndex + (placeAfter ? 1 : 0);
    return sourceIndex < requestedIndex ? requestedIndex - 1 : requestedIndex;
  }

  return Object.freeze({
    moveItemRelative,
    tabDropIndex
  });
});
