<script lang="ts">
  import { onMount, onDestroy, type Snippet } from 'svelte';
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
  let online = $state(false);
  let announcement = $state('');
  let openRooms = $state<api.RoomView[]>([]);
  let myRooms = $state<api.RoomView[]>([]);
  let liveRooms = $state<api.RoomView[]>([]);
  let chat = $state<api.ChatMsg[]>([]);
  let chatInput = $state('');
  let lastChatId = 0;
  let busy = $state(false);
  let err = $state<string | null>(null);

  let inviteCode = $state('');
  let copiedCode = $state('');
  let guestName = $state('');
  let modalOpen = $state(false);
  let settingsOpen = $state(false);
  let dmMsg = $state('');
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
  const players = (r: api.RoomView) =>
    r.seats.map((s) => ({ name: s.bot ? s.name : s.discordId ? s.name : 'open', bot: s.bot, open: !s.bot && !s.discordId }));
  const roomHref = (r: api.RoomView) => `${base}/${r.title}/room/${r.code}`;
  const waitHref = (code: string) => `${base}/wait/${code}`;
  const hostName = (r: api.RoomView) => r.seats.find((s) => s.discordId === r.creatorDiscordId)?.name ?? 'host';
  const activeName = (r: api.RoomView) => r.seats.find((s) => s.seatId === r.activePlayer)?.name ?? '-';

  function ago(t: number): string {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }

  async function refreshOnline() {
    if (!online) return;
    try { announcement = (await api.getAnnouncement()).message; } catch { /* ignore */ }
    try { openRooms = await api.listOpenRooms(); } catch { /* ignore */ }
    try { liveRooms = await api.listLiveRooms(); } catch { /* ignore */ }
    if (auth.signedIn) {
      try { myRooms = await api.listMyRooms(); } catch { /* ignore */ }
    } else myRooms = [];
  }

  async function pollChat() {
    if (!online) return;
    try {
      const msgs = await api.lobbyChat(lastChatId);
      if (msgs.length) {
        chat = [...chat, ...msgs].slice(-50);
        lastChatId = chat[chat.length - 1].id;
      }
    } catch { /* ignore */ }
  }

  async function send() {
    const body = chatInput.trim();
    if (!body || !auth.signedIn) return;
    chatInput = '';
    try { await api.postLobbyChat(body); } catch { /* ignore */ }
    await pollChat();
  }

  function signIn() {
    location.href = auth.loginUrl(`${location.origin}${base}`);
  }
  async function playGuest() {
    busy = true; err = null;
    try { await auth.signInAnon(guestName.trim()); await refreshOnline(); }
    catch (e) { err = (e as Error).message; } finally { busy = false; }
  }
  async function signOut() {
    await auth.signOut(); myRooms = []; settingsOpen = false; await refreshOnline();
  }

  async function testDm() {
    dmMsg = 'Sending...';
    try {
      const r = await api.testNotify();
      dmMsg = r.ok ? 'Sent! Check your Discord DMs.' : `Could not send (${r.error ?? 'error'}).`;
    } catch (e) {
      dmMsg = (e as api.ApiError).status === 409 ? 'Discord is not configured on the server.' : 'Failed to send.';
    }
  }
  async function toggleNotify(key: 'notifyTurn' | 'notifyAuction', value: boolean) {
    try { const n = await api.setNotify({ [key]: value }); if (auth.profile) auth.profile.notify = n; }
    catch { /* ignore */ }
  }

  async function createOnline() {
    busy = true; err = null;
    try {
      const seats = Array.from({ length: newPlayers }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}`, bot: false }));
      const room = await api.createRoom({ title: newTitle, mapMode: 'auto', seats });
      modalOpen = false;
      goto(waitHref(room.code)); // -> waiting room (assign bots, then start)
    } catch (e) { err = (e as Error).message; busy = false; }
  }

  // Join an open table, then land in its waiting room.
  async function joinRoom(r: api.RoomView) {
    const open = r.seats.find((s) => !s.taken);
    if (!open) return goto(waitHref(r.code));
    busy = true; err = null;
    try { await api.claimSeat(r.code, open.seatId); goto(waitHref(r.code)); }
    catch (e) { err = (e as Error).message; busy = false; }
  }

  function joinByCode() {
    const c = inviteCode.trim().toLowerCase();
    if (c) goto(waitHref(c));
  }

  function copyInvite(code: string) {
    const url = `${location.origin}${base}/room/${code}`;
    navigator.clipboard?.writeText(url).then(() => {
      copiedCode = code;
      setTimeout(() => (copiedCode = ''), 1500);
    });
  }

  function removeLocal(code: string) {
    deleteSession(code); refreshLocal();
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

<svelte:window onkeydown={(e) => modalOpen && e.key === 'Escape' && (modalOpen = false)} />

<main in:fade={{ duration: 400 }}>
  <header class="hero">
    <div class="badge" in:fly={{ y: -12, duration: 500 }}>18xx · web</div>
    <h1 in:fly={{ y: 16, duration: 500, delay: 80 }}>Trains Party</h1>
    <p class="tagline" in:fly={{ y: 16, duration: 500, delay: 160 }}>
      Modern, animated web ports of the 18xx railway games.
    </p>
  </header>

  {#if online && !auth.loading && !auth.signedIn}
    <!-- LOGIN -->
    <section class="login" in:fade={{ duration: 300 }}>
      <h2>Sign in to play</h2>
      {#if auth.canSignIn}
        <button class="discord" onclick={signIn}>Sign in with Discord</button>
        <div class="or"><span>or</span></div>
      {/if}
      <form class="guest" onsubmit={(e) => { e.preventDefault(); playGuest(); }}>
        <input placeholder="Choose a display name" bind:value={guestName} maxlength="24" />
        <button class="play" disabled={busy}>Play as guest</button>
      </form>
      <p class="hint">Guests can create and join games and chat. Discord adds turn notifications and invites by DM.</p>
      {#if err}<p class="err">{err}</p>{/if}
    </section>
  {:else if online && auth.signedIn}
    <!-- LOBBY (high-frontier-style dashboard) -->
    {#snippet gameCard(r: api.RoomView, actions: Snippet<[api.RoomView]>)}
      <div class="gcard" style="--accent:{accentOf(r.title)}">
        <div class="ginfo">
          <div class="gname">{titleOf(r.title)} <span class="gcode">{r.code.toUpperCase()}</span></div>
          <div class="gmeta">hosted by <b>{hostName(r)}</b><span class="dot">•</span>{seatCount(r)}{#if r.status === 'active'}<span class="dot">•</span><b class="turn">{activeName(r)}</b>'s turn{/if}<span class="dot">•</span>{r.label}<span class="dot">•</span>{ago(r.updatedAt || 0)}</div>
          <div class="gplayers">{#each players(r) as p}<span class="pchip" class:bot={p.bot} class:open={p.open}>{p.name}</span>{/each}</div>
        </div>
        <div class="gact">{@render actions(r)}</div>
      </div>
    {/snippet}
    {#snippet resumeAct(r: api.RoomView)}<a class="play sm" href={roomHref(r)}>Resume</a>{/snippet}
    {#snippet openAct(r: api.RoomView)}
      {#if amIn(r)}
        <a class="play sm" href={waitHref(r.code)}>Manage</a>
        <button class="ghost sm" onclick={() => copyInvite(r.code)}>{copiedCode === r.code ? 'Copied!' : 'Invite'}</button>
      {:else if r.seats.some((s) => !s.taken)}<button class="play sm" disabled={busy} onclick={() => joinRoom(r)}>Join</button>
      {:else}<span class="muted sm">Full</span>{/if}
    {/snippet}
    {#snippet watchAct(r: api.RoomView)}<a class="ghost sm" href={roomHref(r)}>Watch</a>{/snippet}
    {#snippet reviewAct(r: api.RoomView)}<a class="ghost sm" href={roomHref(r)}>Review</a>{/snippet}

    <div class="lobby" in:fade={{ duration: 300 }}>
      <div class="topbar">
        <button class="play newbtn" onclick={() => { err = null; modalOpen = true; }}>+ New game</button>
        <form class="joinform" onsubmit={(e) => { e.preventDefault(); joinByCode(); }}>
          <input placeholder="invite code" bind:value={inviteCode} maxlength="12" />
          <button class="ghost">Join</button>
        </form>
        <span class="tbspacer"></span>
        <button class="who" onclick={() => (settingsOpen = !settingsOpen)} title="Settings">
          {#if auth.profile?.avatar}<img class="av" src={auth.profile.avatar} alt="" />{/if}
          <span>{auth.profile?.name}</span>{#if auth.isGuest}<span class="gtag">guest</span>{/if}
        </button>
        <button class="ghost" onclick={signOut}>Sign out</button>
      </div>

      {#if settingsOpen}
        <section class="panel settings">
          <h2>Settings</h2>
          {#if auth.isGuest}
            <p class="muted">Playing as a guest. Sign in with Discord for turn notifications and DM invites.</p>
            <button class="discord" onclick={signIn}>Sign in with Discord</button>
          {:else}
            <label class="srow"><input type="checkbox" checked={auth.profile?.notify.notifyTurn} onchange={(e) => toggleNotify('notifyTurn', e.currentTarget.checked)} /> DM me when it's my turn</label>
            <label class="srow"><input type="checkbox" checked={auth.profile?.notify.notifyAuction} onchange={(e) => toggleNotify('notifyAuction', e.currentTarget.checked)} /> DM me when an auction opens</label>
            <div class="srow"><button class="ghost sm" onclick={testDm}>Send test DM</button> <span class="muted">{dmMsg}</span></div>
          {/if}
        </section>
      {/if}

      {#if err}<p class="err">{err}</p>{/if}

      <div class="lgrid">
        <section class="panel chatpanel">
          <h2>Global chat</h2>
          {#if announcement}<div class="announce">{announcement}</div>{/if}
          <div class="cmsgs">
            {#each chat as m (m.id)}<div class="cmsg"><span class="cname">{m.name}</span> {m.body}</div>{:else}<div class="empty">No messages yet. Say hi!</div>{/each}
          </div>
          <form class="cform" onsubmit={(e) => { e.preventDefault(); send(); }}>
            <input placeholder="Message everyone…" bind:value={chatInput} maxlength="500" />
            <button class="play sm" disabled={!chatInput.trim()}>Send</button>
          </form>
        </section>

        <section class="panel">
          <h2>Your games</h2>
          {#each myActive as r (r.code)}{@render gameCard(r, resumeAct)}{:else}<p class="empty">No games in progress.</p>{/each}
        </section>
      </div>

      <div class="lgrid3">
        <section class="panel">
          <h2>Open tables</h2>
          {#each openRooms as r (r.code)}{@render gameCard(r, openAct)}{:else}<p class="empty">No open tables.</p>{/each}
        </section>
        <section class="panel">
          <h2>Live games</h2>
          {#each liveRooms as r (r.code)}{@render gameCard(r, watchAct)}{:else}<p class="empty">No live games.</p>{/each}
        </section>
        <section class="panel">
          <h2>Ended games</h2>
          {#each myFinished as r (r.code)}{@render gameCard(r, reviewAct)}{:else}<p class="empty">None yet.</p>{/each}
        </section>
      </div>

      {#if sessions.length}
        <section class="panel">
          <h2>Local games (this device)</h2>
          <ul class="rooms">
            {#each sessions as s (s.code)}
              <li class="room" style="--accent:{accentOf(s.title)}">
                <a class="rmain" href={`${base}/${s.title}/room/${s.code}`}>
                  <span class="rtitle">{titleOf(s.title)}</span>
                  <span class="rcode">{s.code.toUpperCase()}</span>
                  <span class="rmeta">{s.seats.length} players<span class="dot">•</span>{s.status}<span class="dot">•</span>{ago(s.updatedAt)}</span>
                </a>
                <button class="rdel" onclick={() => removeLocal(s.code)}>Delete</button>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </div>

    <!-- New game modal: pick a title (big buttons) + players, then create -->
    {#if modalOpen}
      <div class="backdrop">
        <button class="bdrop-close" aria-label="Close" onclick={() => (modalOpen = false)}></button>
        <div class="modal" role="dialog" aria-modal="true" tabindex="-1">
          <button class="modalx" aria-label="Close" onclick={() => (modalOpen = false)}>×</button>
          <h2 class="mtitle">New game</h2>
          <p class="msub">Choose a game</p>
          <div class="gamegrid">
            {#each playable as g (g.id)}
              <button class="gamebtn" class:sel={newTitle === g.id} style="--accent:{g.accent}" onclick={() => (newTitle = g.id)}>
                <span class="gbtitle">{g.title}</span>
                {#if g.subtitle}<span class="gbsub">{g.subtitle}</span>{/if}
              </button>
            {/each}
          </div>
          <div class="mrow">
            <label>Players
              <select bind:value={newPlayers}>
                {#each [2, 3, 4] as n}<option value={n}>{n}</option>{/each}
              </select>
            </label>
            <button class="play" disabled={busy} onclick={createOnline}>Create game</button>
          </div>
          {#if err}<p class="err">{err}</p>{/if}
        </div>
      </div>
    {/if}
  {/if}

  <footer class="foot" in:fade={{ duration: 600, delay: 500 }}>
    <span>Trains Party</span><span class="dot">•</span><span>build {BUILD_SHA}</span>
  </footer>
</main>

<style>
  main { max-width: 1040px; margin: 0 auto; padding: clamp(1.5rem, 5vw, 3.5rem) 1.25rem 3rem; text-align: center; }
  .badge {
    display: inline-block; font-size: 0.8rem; letter-spacing: 0.12em; text-transform: uppercase;
    color: var(--rail); border: 1px solid var(--rail-deep); border-radius: 999px; padding: 0.35rem 0.9rem;
    background: rgba(245, 197, 66, 0.06);
  }
  h1 {
    font-size: clamp(2.4rem, 9vw, 4.5rem); margin: 1rem 0 0.4rem;
    background: linear-gradient(120deg, var(--ink), var(--rail));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .tagline { color: var(--muted); margin: 0 auto 2rem; max-width: 46ch; }
  .play {
    padding: 0.55rem 1.1rem; border-radius: 999px; background: var(--rail); color: #1b1b1b;
    font-weight: 800; text-decoration: none; border: 0; cursor: pointer;
    transition: transform 160ms ease, box-shadow 160ms ease;
  }
  .play:hover { transform: translateY(-2px); box-shadow: 0 6px 20px rgba(245, 197, 66, 0.25); }
  .play:disabled { opacity: 0.5; cursor: default; transform: none; box-shadow: none; }
  .play.sm { padding: 0.35rem 0.8rem; font-size: 0.8rem; }
  .ghost {
    border: 1px solid var(--line); background: none; color: var(--ink); border-radius: 999px;
    padding: 0.4rem 0.9rem; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center;
  }
  .ghost.sm { padding: 0.35rem 0.8rem; font-size: 0.8rem; }
  .discord { border: 0; background: #5865f2; color: #fff; border-radius: 999px; padding: 0.6rem 1.3rem; font-weight: 700; cursor: pointer; font-size: 1rem; align-self: flex-start; }
  /* login */
  .login { max-width: 420px; margin: 0 auto; border: 1px solid var(--line); background: var(--bg-soft); border-radius: 16px; padding: 1.6rem 1.4rem; display: flex; flex-direction: column; gap: 0.9rem; }
  .login h2 { margin: 0; font-size: 1.2rem; }
  .or { display: flex; align-items: center; gap: 0.6rem; color: var(--muted); font-size: 0.8rem; }
  .or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--line); }
  .guest { display: flex; gap: 0.5rem; }
  .guest input, .mrow select, .joinform input { background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: 0.5rem 0.7rem; font: inherit; }
  .guest input { flex: 1; }
  .hint { color: var(--muted); font-size: 0.78rem; margin: 0; }
  .err { color: #e0655c; font-size: 0.85rem; }
  /* dashboard */
  .lobby { text-align: left; }
  .topbar { display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; margin-bottom: 1rem; }
  .joinform { display: flex; gap: 0.4rem; }
  .joinform input { border-radius: 999px; width: 130px; }
  .tbspacer { flex: 1; }
  .who { display: inline-flex; align-items: center; gap: 0.4rem; font-weight: 600; background: none; border: 1px solid var(--line); color: var(--ink); border-radius: 999px; padding: 0.3rem 0.75rem; cursor: pointer; }
  .av { width: 22px; height: 22px; border-radius: 50%; }
  .gtag { font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); border: 1px solid var(--line); border-radius: 999px; padding: 0.05rem 0.4rem; }
  .newbtn { font-size: 1rem; padding: 0.55rem 1.2rem; }
  .lgrid { display: grid; grid-template-columns: 1.5fr 1fr; gap: 1rem; align-items: start; }
  .lgrid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-top: 1rem; align-items: start; }
  @media (max-width: 820px) { .lgrid, .lgrid3 { grid-template-columns: 1fr; } }
  .panel { background: var(--bg-soft); border: 1px solid var(--line); border-radius: 14px; padding: 1.2rem 1.35rem; }
  .panel h2 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--rail); margin: 0 0 0.7rem; }
  .settings { margin-bottom: 1rem; }
  .srow { display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; margin: 0.35rem 0; }
  .announce { background: rgba(245, 197, 66, 0.08); border: 1px solid var(--rail-deep); border-radius: 10px; padding: 0.55rem 0.8rem; color: var(--ink); font-size: 0.86rem; white-space: pre-wrap; margin-bottom: 0.6rem; }
  .empty { color: var(--muted); font-size: 0.9rem; }
  .muted { color: var(--muted); }
  .muted.sm { font-size: 0.8rem; }
  /* game cards */
  .gcard { display: flex; align-items: center; gap: 1rem; border-top: 1px solid var(--line); padding: 0.85rem 0; }
  .gcard:first-of-type { border-top: 0; padding-top: 0.25rem; }
  .ginfo { flex: 1; min-width: 0; }
  .gname { font-weight: 800; color: var(--accent); line-height: 1.25; }
  .gcode { display: inline-block; font: 700 0.64rem ui-monospace, monospace; color: var(--muted); letter-spacing: 0.05em; border: 1px solid var(--line); border-radius: 5px; padding: 0.05rem 0.35rem; margin-left: 0.25rem; vertical-align: middle; }
  .gmeta { font-size: 0.76rem; color: var(--muted); display: flex; flex-wrap: wrap; gap: 0.25rem; align-items: center; margin: 0.3rem 0; }
  .turn { color: var(--rail); }
  .gplayers { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.2rem; }
  .gact { flex-shrink: 0; display: flex; gap: 0.4rem; align-items: center; }
  .pchip { font-size: 0.72rem; padding: 0.05rem 0.5rem; border-radius: 999px; border: 1px solid var(--line); color: var(--ink); background: rgba(255, 255, 255, 0.03); }
  .pchip.bot { color: var(--muted); }
  .pchip.open { color: var(--muted); opacity: 0.55; border-style: dashed; }
  /* chat panel */
  .chatpanel { display: flex; flex-direction: column; }
  .cmsgs { max-height: 360px; min-height: 150px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.3rem; padding: 0.2rem 0; }
  .cmsg { font-size: 0.88rem; color: var(--ink); }
  .cname { font-weight: 700; color: var(--rail); margin-right: 0.3rem; }
  .cform { display: flex; gap: 0.5rem; padding-top: 0.6rem; margin-top: 0.5rem; border-top: 1px solid var(--line); }
  .cform input { flex: 1; background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: 0.45rem 0.7rem; font: inherit; }
  /* local games list */
  .rooms { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .room { display: flex; align-items: stretch; border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 12px; background: var(--bg); overflow: hidden; }
  .rmain { flex: 1; display: grid; grid-template-columns: 1fr auto; grid-template-areas: 'title code' 'meta meta'; gap: 0.2rem 0.6rem; padding: 0.8rem 1.1rem; text-decoration: none; color: inherit; }
  a.rmain:hover { background: rgba(255, 255, 255, 0.03); }
  .rtitle { grid-area: title; font-weight: 700; color: var(--accent); }
  .rcode { grid-area: code; font: 700 0.72rem ui-monospace, monospace; letter-spacing: 0.05em; color: var(--muted); align-self: center; }
  .rmeta { grid-area: meta; font-size: 0.76rem; color: var(--muted); display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; }
  .rdel { border: none; border-left: 1px solid var(--line); background: none; color: var(--muted); font-size: 0.78rem; padding: 0 0.9rem; cursor: pointer; }
  .rdel:hover { color: #e0655c; background: rgba(224, 101, 92, 0.08); }
  /* new-game modal */
  .backdrop { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 1rem; z-index: 50; }
  .bdrop-close { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: rgba(6, 16, 24, 0.66); cursor: default; }
  .modal { position: relative; z-index: 1; width: 100%; max-width: 460px; background: var(--bg-soft); border: 1px solid var(--line); border-radius: 16px; padding: 1.6rem 1.4rem 1.4rem; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45); }
  .modalx { position: absolute; top: 0.7rem; right: 0.9rem; background: none; border: 0; color: var(--muted); font-size: 1.5rem; line-height: 1; cursor: pointer; }
  .mtitle { margin: 0; font-size: 1.3rem; }
  .msub { margin: 0.2rem 0 0.9rem; color: var(--muted); font-size: 0.85rem; }
  .gamegrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.7rem; }
  .gamebtn {
    display: flex; flex-direction: column; gap: 0.25rem; align-items: flex-start; text-align: left; padding: 0.9rem 1rem;
    background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-left: 4px solid var(--accent);
    border-radius: 12px; cursor: pointer; transition: transform 140ms ease, border-color 140ms ease, background 140ms ease;
  }
  .gamebtn:hover { transform: translateY(-2px); }
  .gamebtn.sel { background: rgba(245, 197, 66, 0.1); border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
  .gbtitle { font-weight: 800; font-size: 1.05rem; color: var(--accent); }
  .gbsub { font-size: 0.78rem; color: var(--muted); }
  .mrow { display: flex; align-items: end; justify-content: space-between; gap: 0.8rem; margin-top: 1.1rem; }
  .mrow label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.78rem; color: var(--muted); }
  .foot { margin-top: 1.8rem; color: var(--muted); font-size: 0.85rem; display: flex; gap: 0.6rem; justify-content: center; align-items: center; }
  .dot { opacity: 0.4; }
</style>
