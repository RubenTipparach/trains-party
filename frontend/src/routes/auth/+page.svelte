<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { base } from '$app/paths';
  import { setToken } from '$lib/api/client';
  import { auth } from '$lib/game/auth.svelte';

  let msg = $state('Signing you in...');

  onMount(async () => {
    const token = new URLSearchParams(location.search).get('token');
    if (token) {
      setToken(token);
      await auth.init();
      msg = auth.signedIn ? 'Signed in. Taking you to the lobby...' : 'Could not complete sign-in.';
    } else {
      msg = 'No sign-in token found.';
    }
    setTimeout(() => goto(`${base}/`, { replaceState: true }), 400);
  });
</script>

<main class="wrap">
  <p>{msg}</p>
</main>

<style>
  .wrap {
    max-width: 600px;
    margin: 5rem auto;
    text-align: center;
    color: var(--muted);
  }
</style>
