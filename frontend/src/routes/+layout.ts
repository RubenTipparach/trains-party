// Prerender the static shell. Dynamic routes (e.g. /room/<CODE>) fall back to
// 404.html and boot the client-side app from there.
export const prerender = true;
export const trailingSlash = 'ignore';
