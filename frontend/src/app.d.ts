// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }

  // Injected at build time by Vite (see vite.config.ts).
  const __BUILD_SHA__: string;
}

export {};
