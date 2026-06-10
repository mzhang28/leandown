export const LEAN_LOADING_DEFAULT_MESSAGE = "Waiting for Lean to build…";

/**
 * Renders a loading indicator shown while the Lean LSP compiles a document.
 */
export function renderLeanLoadingIndicator(
  message: string = LEAN_LOADING_DEFAULT_MESSAGE
): string {
  const safeMessage = message
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  return `<div class="lean-loading" role="status" aria-live="polite" aria-busy="true">
  <div class="lean-loading-spinner" aria-hidden="true"></div>
  <p class="lean-loading-message">${safeMessage}</p>
</div>`;
}
