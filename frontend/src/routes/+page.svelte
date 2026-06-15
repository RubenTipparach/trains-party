<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { base } from '$app/paths';
  import { goto } from '$app/navigation';
  import { fly, fade } from 'svelte/transition';
  import { BUILD_SHA } from '$lib/version';
  import { GAMES } from '$lib/data/games';
  import { listSessions, deleteSession, migrateLegacySaves, type SessionMeta } from '$lib/game/sessions';
  import { auth } from '$lib/game/auth.svelte';
  import * as api from '$lib/api/client';

  // --- local (sandbox) games ---------------------------------------------
  let sessions = $state<SessionMeta[]>([]);
  const refreshLocal = () => (sessions = listSessions());

  // --- online lobby -------------------------------------------------------
  // Set on mount (browser) so the API base is resolved before we decide to show
  // the online sections (avoids an SSR/prerender hydration mismatch).
  let online = $state(false);
  let announcement = $state('');
  let openRooms = $state<api.RoomView[]>([]);
  let myRooms = $state<api.RoomView[]>([]);
  let chat = $state<api.ChatMsg[]>([]);
  let chatInput = $state('');
  let lastChatId = 0;
  let busy = $state(false);
  let err = $state<string | null>(null);

  let newTitle = $state('1889');
  let newPlayers = $state(2);
  const playable = GAMES.filter((g) => g.status === 'playable');

  const myActive = $derived(myRooms.filter((r) => r.status === 'active' && !r.finished));
  const myFinished = $derived(myRooms.filter((r) => r.finished));
  const myDiscordId = $derived(auth.profile?.discordId ?? null);

  const titleOf = (id: string) => GAMES.find((g) => g.id === id)?.title ?? id;
  const accentOf = (id: string) => GAMES.find((g) => g.id === id)?.accent ?? '#f5c542';
  const amIn = (r: api.RoomView) => !!myDiscordId && r.seats.some((s) => s.discordId === myDiscordId);
  const seatCount = (r: api.RoomView) => `${r.seats.filter((s) => s.taken).length}/${r.seats.length}`;

  function ago(t: number): string {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }
  const roomHref = (r: api.RoomView) => `${base}/${r.title}/room/${r.code}`;

  async function refreshOnline() {
    if (!online) return;
    try {
      announcement = (await api.getAnnouncement()).message;
    } catch {
      /* ignore */
    }
    try {
      openRooms = await api.listOpenRooms();
    } catch {
      /* ignore */
    }
    if (auth.signedIn) {
      try {
        myRooms = await api.listMyRooms();
      } catch {
        /* ignore */
      }
    } else myRooms = [];
  }

  async function pollChat() {
    if (!online) return;
    try {
      const msgs = await api.lobbyChat(lastChatId);
      if (msgs.length) {
        chat = [...chat, ...msgs].slice(-200);
        lastChatId = chat[chat.length - 1].id;
      }
    } catch {
      /* ignore */
    }
  }

  async function send() {
    const body = chatInput.trim();
    if (!body || !auth.signedIn) return;
    chatInput = '';
    try {
      await api.postLobbyChat(body);
    } catch {
      /* ignore */
    }
    await pollChat();
  }

  function signIn() {
    location.href = auth.loginUrl(`${location.origin}${base}`);
  }
  async function signOut() {
    await auth.signOut();
    await refreshOnline();
  }

  async function createOnline() {
    if (!auth.signedIn) return signIn();
    busy = true;
    err = null;
    try {
      const seats = Array.from({ length: newPlayers }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}`, bot: false }));
      const room = await api.createRoom({ title: newTitle, mapMode: 'auto', seats });
      await refreshOnline();
      goto(roomHref(room));
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function joinRoom(r: api.RoomView) {
    if (!auth.signedIn) return signIn();
    const open = r.seats.find((s) => !s.taken);
    if (!open) return;
    busy = true;
    err = null;
    try {
      await api.claimSeat(r.code, open.seatId);
      await refreshOnline();
      goto(roomHref(r));
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  async function startRoom(r: api.RoomView) {
    busy = true;
    err = null;
    try {
      await api.startRoom(r.code);
      await refreshOnline();
      goto(roomHref(r));
    } catch (e) {
      err = (e as Error).message;
    } finally {
      busy = false;
    }
  }

  function removeLocal(code: string) {
    deleteSession(code);
    refreshLocal();
  }

  let timers: ReturnType<typeof setInterval>[] = [];
  onMount(async () => {
    online = api.apiConfigured();
    migrateLegacySaves();
    refreshLocal();
    await auth.init();
    await refreshOnline();
    await pollChat();
    if (online) {
      timers.push(setInterval(refreshOnline, 6000));
      timers.push(setInterval(pollChat, 4000));
    }
  });
  onDestroy(() => timers.forEach(clearInterval));
</script>

<main in:fade={{ duration: 400 }}>
  <header class="hero">
    <div class="badge" in:fly={{ y: -12, duration: 500 }}>18xx · web</div>
    <h1 in:fly={{ y: 16, duration: 500, delay: 80 }}>Trains Party</h1>
    <p class="tagline" in:fly={{ y: 16, duration: 500, delay: 160 }}>
      Modern, animated web ports of the 18xx railway games. Pick a title to play.
    </p>
  </header>

  <section class="games">
    {#each GAMES as g, i (g.id)}
      <article class="card" class:soon={g.status === 'coming-soon'} style="--accent:{g.accent}" in:fly={{ y: 20, duration: 420, delay: 220 + i * 90 }}>
        <div class="ctop">
          <h2>{g.title}</h2>
          {#if g.status === 'coming-soon'}<span class="tag">Coming soon</span>{/if}
        </div>
        <p class="sub">{g.subtitle}</p>
        <p class="meta">
          {#if g.players}<span>{g.players} players</span><span class="dot">•</span>{/if}
          <span>{g.publisher}</span>
          {#if g.designer}<span class="dot">•</span><span>{g.designer}</span>{/if}
        </p>
        <p class="blurb">{g.blurb}</p>
        {#if g.status === 'playable' && g.path}
          <div class="actions"><a class="play" href={`${base}${g.path}`}>Play →</a></div>
        {/if}
      </article>
    {/each}
  </section>

  {#if online}
    <section class="lobby" in:fade={{ duration: 400, delay: 240 }}>
      <div class="acct">
        <h2 class="lobtitle">Online lobby</h2>
        {#if auth.loading}
          <span class="muted">…</span>
        {:else if auth.signedIn}
          <span class="who">
            {#if auth.profile?.avatar}<img class="av" src={auth.profile.avatar} alt="" />{/if}
            {auth.profile?.name}
          </span>
          <button class="ghost" onclick={signOut}>Sign out</button>
        {:else if auth.canSignIn}
          <button class="discord" onclick={signIn}>Sign in with Discord</button>
        {:else}
          <span class="muted">Sign-in unavailable</span>
        {/if}
      </div>

      {#if announcement}
        <p class="announce">{announcement}</p>
      {/if}
      {#if err}<p class="err">{err}</p>{/if}

      {#if auth.signedIn}
        <div class="create">
          <label>New game
            <select bind:value={newTitle}>
              {#each playable as g}<option value={g.id}>{g.title}</option>{/each}
            </select>
          </label>
          <label>Players
            <select bind:value={newPlayers}>
              {#each [2, 3, 4] as n}<option value={n}>{n}</option>{/each}
            </select>
          </label>
          <button class="play" disabled={busy} onclick={createOnline}>Create game</button>
        </div>
      {/if}

      <!-- Open games (joinable) -->
      <h3 class="grp">Open games</h3>
      {#if openRooms.length === 0}
        <p class="empty">No open games right now. {#if auth.signedIn}Create one above.{:else}Sign in to host one.{/if}</p>
      {:else}
        <ul class="rooms">
          {#each openRooms as r (r.code)}
            <li class="room" style="--accent:{accentOf(r.title)}">
              <div class="rmain">
                <span class="rtitle">{titleOf(r.title)}</span>
                <span class="rcode">Room {r.code.toUpperCase()}</span>
                <span class="rmeta">{seatCount(r)} players<span class="dot">•</span>{r.label}<span class="dot">•</span>{ago(r.updatedAt || 0)}</span>
              </div>
              <div class="rbtns">
                {#if amIn(r) && r.creatorDiscordId === myDiscordId}
                  <button class="play sm" disabled={busy} onclick={() => startRoom(r)}>Start</button>
                {:else if amIn(r)}
                  <a class="ghost sm" href={roomHref(r)}>Open</a>
                {:else if r.seats.some((s) => !s.taken)}
                  <button class="play sm" disabled={busy} onclick={() => joinRoom(r)}>Join</button>
                {:else}
                  <span class="muted sm">Full</span>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      {/if}

      {#if auth.signedIn}
        <!-- My games (in progress) -->
        <h3 class="grp">My games</h3>
        {#if myActive.length === 0}
          <p class="empty">No games in progress.</p>
        {:else}
          <ul class="rooms">
            {#each myActive as r (r.code)}
              <li class="room" style="--accent:{accentOf(r.title)}">
                <a class="rmain" href={roomHref(r)}>
                  <span class="rtitle">{titleOf(r.title)}</span>
                  <span class="rcode">Room {r.code.toUpperCase()}</span>
                  <span class="rmeta">{r.label}<span class="dot">•</span>{r.seq} moves<span class="dot">•</span>{ago(r.updatedAt || 0)}</span>
                </a>
                <a class="ghost sm rbtns" href={roomHref(r)}>Resume</a>
              </li>
            {/each}
          </ul>
        {/if}

        <!-- Finished games -->
        <h3 class="grp">Finished games</h3>
        {#if myFinished.length === 0}
          <p class="empty">No finished games yet.</p>
        {:else}
          <ul class="rooms">
            {#each myFinished as r (r.code)}
              <li class="room dim" style="--accent:{accentOf(r.title)}">
                <a class="rmain" href={roomHref(r)}>
                  <span class="rtitle">{titleOf(r.title)}</span>
                  <span class="rcode">Room {r.code.toUpperCase()}</span>
                  <span class="rmeta">Finished<span class="dot">•</span>{r.seq} moves<span class="dot">•</span>{ago(r.updatedAt || 0)}</span>
                </a>
                <a class="ghost sm rbtns" href={roomHref(r)}>Review</a>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}

      <!-- Lobby chat -->
      <h3 class="grp">Lobby chat</h3>
      <div class="chat">
        <div class="cmsgs">
          {#each chat as m (m.id)}
            <div class="cmsg"><span class="cname">{m.name}</span> {m.body}</div>
          {:else}
            <div class="empty">No messages yet. Say hi!</div>
          {/each}
        </div>
        <form class="cform" onsubmit={(e) => { e.preventDefault(); send(); }}>
          <input
            placeholder={auth.signedIn ? 'Message the lobby…' : 'Sign in to chat'}
            bind:value={chatInput}
            disabled={!auth.signedIn}
            maxlength="500"
          />
          <button class="play sm" disabled={!auth.signedIn || !chatInput.trim()}>Send</button>
        </form>
      </div>
    </section>
  {/if}

  <section class="lobby" in:fade={{ duration: 400, delay: 320 }}>
    <h2 class="lobtitle">Your games (on this device)</h2>
    {#if sessions.length === 0}
      <p class="empty">No local games yet. Pick a title above to start one - each game gets its own room.</p>
    {:else}
      <ul class="rooms">
        {#each sessions as s (s.code)}
          <li class="room" style="--accent:{accentOf(s.title)}">
            <a class="rmain" href={`${base}/${s.title}/room/${s.code}`}>
              <span class="rtitle">{titleOf(s.title)}</span>
              <span class="rcode">Room {s.code.toUpperCase()}</span>
              <span class="rmeta">{s.seats.length} players<span class="dot">•</span>{s.status}<span class="dot">•</span>{s.moves} moves<span class="dot">•</span>{ago(s.updatedAt)}</span>
            </a>
            <button class="rdel" title="Delete this game" onclick={() => removeLocal(s.code)}>Delete</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <footer class="foot" in:fade={{ duration: 600, delay: 700 }}>
    <span>Trains Party</span><span class="dot">•</span><span>build {BUILD_SHA}</span>
  </footer>
</main>

<style>
  main {
    max-width: 880px;
    margin: 0 auto;
    padding: clamp(2rem, 6vw, 4rem) 1.25rem 3rem;
    text-align: center;
  }
  .badge {
    display: inline-block;
    font-size: 0.8rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--rail);
    border: 1px solid var(--rail-deep);
    border-radius: 999px;
    padding: 0.35rem 0.9rem;
    background: rgba(245, 197, 66, 0.06);
  }
  h1 {
    font-size: clamp(2.4rem, 9vw, 4.5rem);
    margin: 1rem 0 0.4rem;
    background: linear-gradient(120deg, var(--ink), var(--rail));
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .tagline {
    color: var(--muted);
    margin: 0 auto 2rem;
    max-width: 46ch;
  }
  .games {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem;
    text-align: left;
  }
  .card {
    border: 1px solid var(--line);
    border-top: 3px solid var(--accent);
    background: var(--bg-soft);
    border-radius: 16px;
    padding: 1.1rem 1.2rem 1.2rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .card.soon { opacity: 0.92; }
  .ctop { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
  .card h2 { margin: 0; font-size: 1.3rem; color: var(--accent); }
  .tag {
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.1rem 0.5rem;
    white-space: nowrap;
  }
  .sub { margin: 0; font-weight: 600; }
  .meta { margin: 0; font-size: 0.78rem; color: var(--muted); display: flex; flex-wrap: wrap; gap: 0.35rem; align-items: center; }
  .blurb { margin: 0.3rem 0 0.6rem; font-size: 0.86rem; color: var(--ink); flex: 1; }
  .actions { display: flex; align-items: center; gap: 0.6rem; }
  .play {
    padding: 0.55rem 1.1rem;
    border-radius: 999px;
    background: var(--rail);
    color: #1b1b1b;
    font-weight: 800;
    text-decoration: none;
    border: 0;
    cursor: pointer;
    transition: transform 160ms ease, box-shadow 160ms ease;
  }
  .play:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(245, 197, 66, 0.25); }
  .play:disabled { opacity: 0.5; cursor: default; transform: none; box-shadow: none; }
  .play.sm, .ghost.sm, .muted.sm { padding: 0.35rem 0.8rem; font-size: 0.8rem; }
  .ghost {
    border: 1px solid var(--line);
    background: none;
    color: var(--ink);
    border-radius: 999px;
    padding: 0.4rem 0.9rem;
    cursor: pointer;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }
  .discord {
    border: 0;
    background: #5865f2;
    color: #fff;
    border-radius: 999px;
    padding: 0.45rem 1rem;
    font-weight: 700;
    cursor: pointer;
  }
  .lobby { margin-top: 2.4rem; text-align: left; }
  .lobtitle { font-size: 1.05rem; margin: 0; color: var(--ink); }
  .acct { display: flex; align-items: center; gap: 0.8rem; flex-wrap: wrap; margin-bottom: 0.6rem; }
  .acct .who { margin-left: auto; display: inline-flex; align-items: center; gap: 0.4rem; font-weight: 600; }
  .av { width: 22px; height: 22px; border-radius: 50%; }
  .announce {
    background: rgba(245, 197, 66, 0.08);
    border: 1px solid var(--rail-deep);
    border-radius: 10px;
    padding: 0.6rem 0.9rem;
    color: var(--ink);
    font-size: 0.9rem;
    white-space: pre-wrap;
  }
  .err { color: #e0655c; font-size: 0.85rem; }
  .create { display: flex; flex-wrap: wrap; gap: 0.7rem; align-items: end; margin: 0.6rem 0 0.4rem; }
  .create label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.78rem; color: var(--muted); }
  .create select {
    background: var(--bg-soft);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0.4rem 0.6rem;
    font: inherit;
  }
  .grp { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 1.4rem 0 0.6rem; }
  .empty { color: var(--muted); font-size: 0.9rem; }
  .rooms { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .room {
    display: flex;
    align-items: stretch;
    border: 1px solid var(--line);
    border-left: 3px solid var(--accent);
    border-radius: 12px;
    background: var(--bg-soft);
    overflow: hidden;
  }
  .room.dim { opacity: 0.75; }
  .rmain {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-areas: 'title code' 'meta meta';
    gap: 0.15rem 0.6rem;
    padding: 0.7rem 0.9rem;
    text-decoration: none;
    color: inherit;
  }
  a.rmain:hover { background: rgba(255, 255, 255, 0.03); }
  .rtitle { grid-area: title; font-weight: 700; color: var(--accent); }
  .rcode { grid-area: code; font: 700 0.75rem ui-monospace, monospace; letter-spacing: 0.06em; color: var(--muted); align-self: center; }
  .rmeta { grid-area: meta; font-size: 0.78rem; color: var(--muted); display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; }
  .rbtns { display: flex; align-items: center; gap: 0.4rem; padding: 0 0.7rem; border-left: 1px solid var(--line); }
  .rdel {
    border: none;
    border-left: 1px solid var(--line);
    background: none;
    color: var(--muted);
    font-size: 0.78rem;
    padding: 0 0.9rem;
    cursor: pointer;
  }
  .rdel:hover { color: #e0655c; background: rgba(224, 101, 92, 0.08); }
  .chat { border: 1px solid var(--line); border-radius: 12px; background: var(--bg-soft); overflow: hidden; }
  .cmsgs { max-height: 230px; overflow-y: auto; padding: 0.7rem 0.9rem; display: flex; flex-direction: column; gap: 0.35rem; }
  .cmsg { font-size: 0.88rem; color: var(--ink); }
  .cname { font-weight: 700; color: var(--rail); margin-right: 0.3rem; }
  .cform { display: flex; gap: 0.5rem; padding: 0.6rem; border-top: 1px solid var(--line); }
  .cform input {
    flex: 1;
    background: var(--bg);
    color: var(--ink);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 0.45rem 0.7rem;
    font: inherit;
  }
  .foot { margin-top: 1.4rem; color: var(--muted); font-size: 0.85rem; display: flex; gap: 0.6rem; justify-content: center; align-items: center; }
  .dot { opacity: 0.4; }
  .muted { color: var(--muted); }
</style>
