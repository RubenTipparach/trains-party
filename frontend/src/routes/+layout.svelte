<script lang="ts">
  import '../app.css';
  import { updated } from '$app/state';

  let { children } = $props();

  // When CI ships a new build, SvelteKit's version poll flips `updated.current`.
  // Reload to pick it up - the URL (and so the /room/<code>) is preserved, and
  // game state lives in localStorage / on the server, so nothing is lost.
  $effect(() => {
    if (updated.current) location.reload();
  });
</script>

{@render children()}
