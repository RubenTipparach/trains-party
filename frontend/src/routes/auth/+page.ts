// The sign-in landing page runs entirely client-side: it reads the one-time
// token the server appended to the URL, so it must not be prerendered.
export const prerender = false;
export const ssr = false;
