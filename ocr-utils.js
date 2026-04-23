(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.SV98OCR = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeOcrText(text) {
    return String(text || "")
      .replace(/\r/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function scoreOcrText(text) {
    const normalized = normalizeOcrText(text);
    if (!normalized) return 0;

    const thai = (normalized.match(/[\u0E00-\u0E7F]/g) || []).length;
    const latin = (normalized.match(/[A-Za-z]/g) || []).length;
    const digits = (normalized.match(/[0-9]/g) || []).length;
    const lines = normalized.split("\n").filter(Boolean).length;
    const uniqueChars = new Set(normalized.replace(/\s/g, "").split("")).size;

    return thai * 3 + latin * 2 + digits * 2 + lines * 4 + uniqueChars;
  }

  function pickBestOcrCandidate(candidates) {
    const ranked = (candidates || [])
      .map((candidate) => {
        const text = normalizeOcrText(candidate && candidate.text);
        return {
          ...candidate,
          text: text,
          score:
            typeof candidate?.score === "number"
              ? candidate.score
              : scoreOcrText(text),
        };
      })
      .sort((a, b) => b.score - a.score);

    return ranked[0] || null;
  }

  return {
    normalizeOcrText: normalizeOcrText,
    scoreOcrText: scoreOcrText,
    pickBestOcrCandidate: pickBestOcrCandidate,
  };
});
