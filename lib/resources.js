(function attachResourceLibrary(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.GXTabResources = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createResourceLibrary() {
  "use strict";

  const MAX_DATA_ICON_LENGTH = 1_000_000;
  const BROWSER_MANAGED_PROTOCOLS = new Set([
    "chrome:",
    "chrome-extension:",
    "opera:"
  ]);
  const WEB_PAGE_PROTOCOLS = new Set(["http:", "https:"]);
  const LOCAL_RASTER_DATA_IMAGE = /^data:image\/(?:avif|bmp|gif|jpe?g|png|webp|x-icon|vnd\.microsoft\.icon);base64,[a-z0-9+/=\s]+$/i;

  function safeFaviconUrl(value) {
    if (typeof value !== "string") return "";
    const candidate = value.trim();
    if (!candidate) return "";

    if (candidate.toLocaleLowerCase().startsWith("data:")) {
      if (candidate.length > MAX_DATA_ICON_LENGTH) return "";
      return LOCAL_RASTER_DATA_IMAGE.test(candidate) ? candidate : "";
    }

    try {
      const url = new URL(candidate);
      return BROWSER_MANAGED_PROTOCOLS.has(url.protocol) ? url.href : "";
    } catch (_error) {
      return "";
    }
  }

  function browserFaviconUrl(pageValue, endpointValue) {
    if (typeof pageValue !== "string" || typeof endpointValue !== "string") return "";

    try {
      const page = new URL(pageValue.trim());
      const endpoint = new URL(endpointValue.trim());
      if (!WEB_PAGE_PROTOCOLS.has(page.protocol)) return "";
      if (
        endpoint.protocol !== "chrome-extension:" ||
        !endpoint.hostname ||
        endpoint.pathname !== "/_favicon/"
      ) {
        return "";
      }

      endpoint.search = "";
      endpoint.hash = "";
      endpoint.searchParams.set("pageUrl", page.href);
      endpoint.searchParams.set("size", "32");
      return endpoint.href;
    } catch (_error) {
      return "";
    }
  }

  function relativeLuminance(red, green, blue) {
    const channels = [red, green, blue].map((channel) => {
      const normalized = Math.max(0, Math.min(255, Number(channel))) / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : Math.pow((normalized + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function contrastRatio(first, second) {
    const lighter = Math.max(first, second);
    const darker = Math.min(first, second);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function shouldInvertFavicon(pixelData, backgroundRgb) {
    if (!pixelData || typeof pixelData.length !== "number" || pixelData.length < 4) return false;
    if (!Array.isArray(backgroundRgb) || backgroundRgb.length < 3) return false;
    if (!backgroundRgb.slice(0, 3).every((channel) => Number.isFinite(channel))) return false;

    const background = backgroundRgb.slice(0, 3).map((channel) => Math.max(0, Math.min(255, channel)));
    const backgroundLuminance = relativeLuminance(...background);
    let originalContrast = 0;
    let invertedContrast = 0;
    let totalWeight = 0;

    for (let index = 0; index + 3 < pixelData.length; index += 4) {
      const alpha = Math.max(0, Math.min(255, Number(pixelData[index + 3]))) / 255;
      if (alpha < 0.08) continue;
      const weight = alpha * alpha;
      const original = [0, 1, 2].map((offset) => {
        const channel = Math.max(0, Math.min(255, Number(pixelData[index + offset])));
        return channel * alpha + background[offset] * (1 - alpha);
      });
      const inverted = [0, 1, 2].map((offset) => {
        const channel = Math.max(0, Math.min(255, Number(pixelData[index + offset])));
        return (255 - channel) * alpha + background[offset] * (1 - alpha);
      });
      originalContrast += contrastRatio(relativeLuminance(...original), backgroundLuminance) * weight;
      invertedContrast += contrastRatio(relativeLuminance(...inverted), backgroundLuminance) * weight;
      totalWeight += weight;
    }

    if (totalWeight < 1) return false;
    const originalAverage = originalContrast / totalWeight;
    const invertedAverage = invertedContrast / totalWeight;
    return originalAverage < 2.5 &&
      invertedAverage >= 3 &&
      invertedAverage >= originalAverage + 0.75 &&
      invertedAverage >= originalAverage * 1.35;
  }

  return Object.freeze({
    MAX_DATA_ICON_LENGTH,
    browserFaviconUrl,
    safeFaviconUrl,
    shouldInvertFavicon
  });
});
