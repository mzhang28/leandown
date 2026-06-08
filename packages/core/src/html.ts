/**
 * Wraps highlighted Lean code in a preformatted HTML block.
 *
 * This function takes the raw highlighted HTML string and returns it wrapped
 * within standard `<pre><code class="language-lean">` tags for web rendering.
 */
export function wrapLeanCodeBlock(highlightedHtml: string): string {
  return `<pre><code class="language-lean">${highlightedHtml}</code></pre>`;
}
