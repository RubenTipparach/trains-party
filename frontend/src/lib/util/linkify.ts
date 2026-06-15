/**
 * Turn https URLs in plain text into safe clickable links, mirroring the High
 * Frontier lobby. Everything is HTML-escaped for its context; only matched URLs
 * become <a> tags (href and text both escaped). Trailing sentence punctuation is
 * kept as text, not part of the link. The result is safe to use with {@html}.
 */

const URL_RE = /https?:\/\/[^\s<>"']+/g;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function linkify(text: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    out += escapeHtml(text.slice(last, start));
    let url = m[0];
    let trail = '';
    const t = url.match(/[.,!?;:)\]]+$/); // don't swallow a sentence's punctuation
    if (t) {
      trail = url.slice(url.length - t[0].length);
      url = url.slice(0, url.length - t[0].length);
    }
    out += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>${escapeHtml(trail)}`;
    last = start + m[0].length;
  }
  out += escapeHtml(text.slice(last));
  return out;
}
