<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import { GAMES } from '$lib/data/games';
  import { auth } from '$lib/game/auth.svelte';
  import * as api from '$lib/api/client';

  const code = $page.params.code ?? '';
  let room = $state<api.RoomView | null>(null);
  let err = $state<string | null>(null);
  let busy = $state(false);
  let guestName = $state('');
  let copied = $state(false);

  const titleOf = (id: string) => GAMES.find((g) => g.id === id)?.title ?? id;
  const myId = $derived(auth.profile?.discordId ?? null);
  const isHost = $derived(!!room && !!myId && room.creatorDiscordId === myId);
  const amSeated = $derived(!!room && !!myId && room.seats.some((s) => s.discordId === myId));
  const humans = $derived(room ? room.seats.filter((s) => s.discordId).length : 0);

  async function refresh() {
    try {
      const r = await api.getRoom(code);
      room = r;
      // Once the host starts, everyone moves to the game board.
      if (r.status !== 'lobby') goto(`${base}/${r.title}/room/${r.code}`, { replaceState: true });
    } catch (e) {
      err = (e as api.ApiError).status === 404 ? 'This room no longer exists.' : (e as Error).message;
    }
  }

  async function act(fn: () => Promise<api.RoomView>) {
    busy = true;
    err = null;
    try {
      room = await fn();
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
    }
  }
  const take = (seatId: string) => act(() => api.claimSeat(code, seatId));
  const leave = (seatId: string) => act(() => api.releaseSeat(code, seatId));
  const makeBot = (seatId: string) => act(() => api.seatBot(code, seatId));
  const makeOpen = (seatId: string) => act(() => api.openSeat(code, seatId));

  async function start() {
    busy = true;
    err = null;
    try {
      const r = await api.startRoom(code);
      goto(`${base}/${r.room?.title ?? room?.title}/room/${code}`, { replaceState: true });
    } catch (e) {
      err = (e as Error).message;
      busy = false;
    }
  }

  function signIn() {
    location.href = auth.loginUrl(`${location.origin}${base}`);
  }
  async function playGuest() {
    busy = true;
    err = null;
    try {
      await auth.signInAnon(guestName.trim());
      await refresh();
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  function copyLink() {
    navigator.clipboard?.writeText(location.href).then(() => {
      copied = true;
      setTimeout(() => (copied = false), 1500);
    });
  }

  let timer: ReturnType<typeof setInterval>;
  onMount(async () => {
    await auth.init();
    await refresh();
    timer = setInterval(refresh, 2500);
  });
  onDestroy(() => clearInterval(timer));

  function seatLabel(s: api.SeatView): string {
    if (s.bot) return s.name;
    if (s.discordId) return s.name + (s.discordId === room?.creatorDiscordId ? ' (host)' : '');
    return 'Open seat';
  }
</script>

<main>
  <a class="back" href={`${base}/`}>&larr; Lobby</a>

  {#if !auth.loading && !auth.signedIn}
    <section class="card login">
      <h1>Join this game</h1>
      <p class="muted">Sign in to take a seat in room <b>{code.toUpperCase()}</b>.</p>
      {#if auth.canSignIn}
        <button class="discord" onclick={signIn}>Sign in with Discord</button>
        <div class="or"><span>or</span></div>
      {/if}
      <form class="guest" onsubmit={(e) => { e.preventDefault(); playGuest(); }}>
        <input placeholder="Display name" bind:value={guestName} maxlength="24" />
        <button class="play" disabled={busy}>Play as guest</button>
      </form>
      {#if err}<p class="err">{err}</p>{/if}
    </section>
  {:else if !room}
    <section class="card"><p class="muted">{err ?? 'Loading room…'}</p></section>
  {:else}
    <section class="card">
      <div class="head">
        <div>
          <h1>{titleOf(room.title)}</h1>
          <p class="muted">Waiting room · Room <b>{room.code.toUpperCase()}</b> · {humans} player{humans === 1 ? '' : 's'} joined</p>
        </div>
        <button class="ghost" onclick={copyLink}>{copied ? 'Copied!' : 'Copy invite link'}</button>
      </div>

      <ul class="seats">
        {#each room.seats as s (s.seatId)}
          <li class="seat" class:open={!s.taken} class:bot={s.bot}>
            <span class="snum">{s.seatId.toUpperCase()}</span>
            <span class="sname">{seatLabel(s)}</span>
            <span class="sctl">
              {#if !s.bot && !s.discordId}
                {#if !amSeated}<button class="play sm" disabled={busy} onclick={() => take(s.seatId)}>Take seat</button>{/if}
                {#if isHost}<button class="ghost sm" disabled={busy} onclick={() => makeBot(s.seatId)}>Add bot</button>{/if}
              {:else if s.discordId === myId}
                <button class="ghost sm" disabled={busy} onclick={() => leave(s.seatId)}>Leave</button>
              {:else if s.bot && isHost}
                <button class="ghost sm" disabled={busy} onclick={() => makeOpen(s.seatId)}>Open up</button>
              {/if}
            </span>
          </li>
        {/each}
      </ul>

      {#if err}<p class="err">{err}</p>{/if}

      <div class="foot">
        {#if isHost}
          <button class="play" disabled={busy} onclick={start}>Start game</button>
          <span class="muted">Empty seats become bots when you start.</span>
        {:else}
          <span class="muted">Waiting for the host to start…</span>
        {/if}
      </div>
    </section>
  {/if}
</main>

<style>
  main { max-width: 620px; margin: 0 auto; padding: clamp(1.5rem, 5vw, 3rem) 1.25rem; }
  .back { color: var(--muted); text-decoration: none; font-size: 0.9rem; }
  .card { margin-top: 1rem; background: var(--bg-soft); border: 1px solid var(--line); border-radius: 16px; padding: 1.4rem; }
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
  h1 { margin: 0; font-size: 1.4rem; }
  .muted { color: var(--muted); }
  .err { color: #e0655c; font-size: 0.85rem; }
  .seats { list-style: none; margin: 1.1rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .seat { display: flex; align-items: center; gap: 0.8rem; border: 1px solid var(--line); border-radius: 10px; padding: 0.6rem 0.9rem; background: var(--bg); }
  .seat.open { border-style: dashed; opacity: 0.85; }
  .seat.bot { color: var(--muted); }
  .snum { font: 700 0.72rem ui-monospace, monospace; color: var(--muted); border: 1px solid var(--line); border-radius: 6px; padding: 0.1rem 0.4rem; }
  .sname { flex: 1; font-weight: 600; }
  .sctl { display: flex; gap: 0.4rem; }
  .foot { display: flex; align-items: center; gap: 0.8rem; margin-top: 1.2rem; flex-wrap: wrap; }
  .play { padding: 0.55rem 1.2rem; border-radius: 999px; background: var(--rail); color: #1b1b1b; font-weight: 800; border: 0; cursor: pointer; }
  .play:disabled { opacity: 0.5; cursor: default; }
  .play.sm { padding: 0.3rem 0.7rem; font-size: 0.8rem; }
  .ghost { border: 1px solid var(--line); background: none; color: var(--ink); border-radius: 999px; padding: 0.4rem 0.9rem; cursor: pointer; }
  .ghost.sm { padding: 0.3rem 0.7rem; font-size: 0.8rem; }
  .login { max-width: 420px; }
  .discord { border: 0; background: #5865f2; color: #fff; border-radius: 999px; padding: 0.55rem 1.2rem; font-weight: 700; cursor: pointer; margin-top: 0.6rem; }
  .or { display: flex; align-items: center; gap: 0.6rem; color: var(--muted); font-size: 0.8rem; margin: 0.7rem 0; }
  .or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--line); }
  .guest { display: flex; gap: 0.5rem; }
  .guest input { flex: 1; background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: 0.5rem 0.7rem; font: inherit; }
</style>
