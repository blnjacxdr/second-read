// Reads the parts of a grounded (Google Search) cloud answer that Google
// requires us to show: the search suggestions (searchEntryPoint.renderedContent)
// and the sources (groundingChunks). Pure function, testable with plain objects.

/**
 * @param {object} response  result.response from the Firebase SDK
 * @returns {{
 *   text: string,
 *   grounded: boolean,
 *   searchSuggestionsHtml: string | null,
 *   sources: Array<{ title: string, uri: string }>,
 *   inferenceSource: string | undefined,
 * }}
 */
export function readGroundedAnswer(response) {
  const text = typeof response.text === 'function' ? response.text() : '';
  const candidate = (response.candidates && response.candidates[0]) || {};
  const meta = candidate.groundingMetadata;

  const sources = [];
  const seen = new Set();
  for (const chunk of (meta && meta.groundingChunks) || []) {
    const web = chunk && chunk.web;
    if (!web || !web.uri || seen.has(web.uri)) continue;
    seen.add(web.uri);
    sources.push({ title: web.title || web.uri, uri: web.uri });
  }

  return {
    text,
    // A response without groundingMetadata is not a grounded result.
    grounded: Boolean(meta),
    searchSuggestionsHtml: (meta && meta.searchEntryPoint && meta.searchEntryPoint.renderedContent) || null,
    sources,
    inferenceSource: response.inferenceSource,
  };
}

/**
 * A link we're willing to put on the page: only https:// web addresses. A grounding source comes from a
 * response, so a "javascript:" or "data:" link must never become clickable. Returns the URL or null.
 */
export function safeLinkUrl(uri) {
  try {
    const url = new URL(String(uri));
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}
