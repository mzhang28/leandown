export { LeanHighlightProcessor } from "./processor.ts";
export type { LeanHighlightOptions } from "./processor.ts";
export { LeanLSPClient } from "./client.ts";
export type { LeanHighlightResult } from "./client.ts";
export { wrapLeanCodeBlock } from "./html.ts";
export {
  renderLeanLoadingIndicator,
  LEAN_LOADING_DEFAULT_MESSAGE,
} from "./loading.ts";
export * from "./lib.ts";
export * from "./backend.ts";
export {
  CACHE_VERSION,
  hashContent,
  getCachedHighlight,
  setCachedHighlight,
  computeProjectFingerprint,
} from "./cache.ts";

