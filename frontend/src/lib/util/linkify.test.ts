import { describe, it, expect } from 'vitest';
import { linkify } from './linkify';

describe('linkify', () => {
  it('turns an https url into a safe link', () => {
    expect(linkify('see https://example.com here')).toBe(
      'see <a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a> here'
    );
  });

  it('keeps trailing sentence punctuation out of the link', () => {
    const out = linkify('go to https://a.b/x.');
    expect(out).toBe(
      'go to <a href="https://a.b/x" target="_blank" rel="noopener noreferrer">https://a.b/x</a>.'
    );
  });

  it('escapes surrounding text and never emits raw html (xss-safe)', () => {
    const out = linkify('<script>alert(1)</script> https://x.y');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('<a href="https://x.y"');
  });

  it('a quote cannot break out of the href attribute', () => {
    const out = linkify('https://x.y/"onmouseover=alert(1)');
    // the quote ends the matched URL and any stray quote in text is escaped
    expect(out).not.toMatch(/"onmouseover/);
    expect(out).toContain('&quot;onmouseover');
  });

  it('leaves plain text untouched (but escaped)', () => {
    expect(linkify('just text & stuff')).toBe('just text &amp; stuff');
  });
});
