<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import * as api from '$lib/api/client';

  const code = $page.params.code ?? '';
  let msg = $state('Opening room...');

  onMount(async () => {
    try {
      const r = await api.getRoom(code);
      // Still gathering players -> waiting room; otherwise the game board.
      const to = r.status === 'lobby' ? `${base}/wait/${code}` : `${base}/${r.title}/room/${code}`;
      goto(to, { replaceState: true });
    } catch {
      msg = 'Room not found.';
      setTimeout(() => goto(`${base}/`, { replaceState: true }), 900);
    }
  });
</script>

<main class="wrap"><p>{msg}</p></main>

<style>
  .wrap { max-width: 600px; margin: 5rem auto; text-align: center; color: var(--muted); }
</style>
