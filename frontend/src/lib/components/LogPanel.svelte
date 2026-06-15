<script lang="ts">
  // The game log on its own panel/tab, so it stays reachable in every round
  // (including operating rounds, where the Game tab shows the board). Newest first.
  // Lines are highlighted: player names take their seat colour, corporation symbols
  // their corp colour, and money amounts a gold accent - so a glance reads the who,
  // the what, and the how-much. Highlighting is XSS-safe: every text fragment is
  // HTML-escaped before insertion and the only literal markup is our own spans.
  import { game } from '$lib/game/sandbox.svelte';

  const SEAT = ['#f5c542', '#3fb6a8', '#e0655c', '#9b8cf0', '#7cc36b', '#e8923a'];
  const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c]);
  const reSafe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Rebuild the token tables + matcher whenever players/corporations change.
  const format = $derived.by(() => {
    const nameColor = new Map<string, string>();
    game.state.players.forEach((p, i) => p.name && nameColor.set(p.name, SEAT[i % SEAT.length]));
    const symColor = new Map<string, string>();
    for (const c of game.state.corporations) symColor.set(c.sym, c.color);

    const names = [...nameColor.keys()].sort((a, b) => b.length - a.length).map(reSafe);
    const syms = [...symColor.keys()].sort((a, b) => b.length - a.length).map(reSafe);
    const parts: string[] = [];
    if (names.length) parts.push(`(?<!\\w)(?:${names.join('|')})(?!\\w)`);
    if (syms.length) parts.push(`(?<![\\w$])(?:${syms.join('|')})(?!\\w)`); // standalone uppercase tokens
    parts.push(`(?<![\\w.])\\d{2,}(?![\\w.%])`); // money amounts (2+ digits; skip round nums / percentages)
    const re = new RegExp(parts.join('|'), 'g');

    return (line: string) => {
      let out = '';
      let last = 0;
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(line))) {
        out += esc(line.slice(last, m.index));
        const t = m[0];
        if (nameColor.has(t)) out += `<span class="pl" style="color:${nameColor.get(t)}">${esc(t)}</span>`;
        else if (symColor.has(t)) out += `<span class="co" style="color:${symColor.get(t)}">${esc(t)}</span>`;
        else out += `<span class="mn">${esc(t)}</span>`;
        last = m.index + t.length;
      }
      return out + esc(line.slice(last));
    };
  });

  const logLines = $derived(game.state.log.map((line, idx) => ({ line, idx })).reverse());
</script>

<div class="log">
  <ul>
    {#each logLines as entry (entry.idx)}
      <li>{@html format(entry.line)}</li>
    {/each}
  </ul>
</div>

<style>
  .log ul {
    list-style: none;
    margin: 0;
    padding: 0.6rem 0.8rem;
    background: var(--bg-soft);
    border: 1px solid var(--line);
    border-radius: 10px;
    font: 0.82rem/1.5 ui-monospace, monospace;
  }
  .log li {
    color: #b7c3cf;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    padding: 0.18rem 0;
  }
  .log :global(.pl) {
    font-weight: 700;
  }
  .log :global(.co) {
    font-weight: 700;
  }
  .log :global(.mn) {
    color: #e6b450;
    font-weight: 600;
  }
</style>
