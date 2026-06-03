<script lang="ts">
  // Legacy entry point. The board now lives at /<title>/room/<code>; send visitors
  // (and the previous single-save game, migrated to a room) there, or to the lobby.
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { listSessions, migrateLegacySaves } from '$lib/game/sessions';

  onMount(() => {
    migrateLegacySaves();
    const recent = listSessions()[0];
    goto(recent ? `${base}/${recent.title}/room/${recent.code}` : `${base}/`, { replaceState: true });
  });
</script>

<p class="redir">Redirecting…</p>

<style>
  .redir {
    padding: 3rem 1rem;
    text-align: center;
    color: var(--muted);
  }
</style>
