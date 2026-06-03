// The room is a dynamic route (/<title>/room/<code>): not prerendered, but served
// by the 404.html SPA fallback. It loads the session from localStorage on the
// client, so this page is the canonical board location.
export const prerender = false;
