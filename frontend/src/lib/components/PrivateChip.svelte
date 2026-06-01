<script lang="ts">
  import { COMPANIES, CURRENCY } from '$lib/data/g1889';

  // Move a node to <body> so a fixed-position popover is never trapped behind a
  // sibling card's stacking context (player cards use opacity < 1).
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      }
    };
  }

  let { sym }: { sym: string } = $props();
  const c = COMPANIES.find((x) => x.sym === sym);
  let open = $state(false);
  let wrapEl: HTMLSpanElement;
  let pos = $state({ left: 0, top: 0 });

  function toggle() {
    if (!open && wrapEl) {
      const r = wrapEl.getBoundingClientRect();
      const width = 240;
      let left = r.left;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      pos = { left: Math.max(8, left), top: r.bottom + 4 };
    }
    open = !open;
  }

  // Close on outside click, scroll, or resize.
  $effect(() => {
    if (!open) return;
    const close = (e?: Event) => {
      if (e && e.type === 'click' && wrapEl && wrapEl.contains(e.target as Node)) return;
      open = false;
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  });
</script>

<span class="wrap" bind:this={wrapEl}>
  <button class="chip" onclick={toggle} aria-expanded={open}>
    <b class="cn">{c?.name ?? sym}</b>
    <span class="meta">{CURRENCY}{c?.value} · +{CURRENCY}{c?.revenue}/OR</span>
  </button>
</span>

{#if open}
  <!-- Portaled to <body> so it is never clipped by, or stacked behind, the
       player cards (which create stacking contexts via opacity < 1). Critical
       layout is inlined because scoped styles do not follow the portal. -->
  <div
    use:portal
    style="position:fixed; z-index:3000; width:240px; left:{pos.left}px; top:{pos.top}px;
           background:#11202c; border:1px solid #c9971f; border-radius:9px;
           padding:0.55rem 0.65rem; box-shadow:0 8px 24px rgba(0,0,0,.5);"
  >
    <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:0.2rem;">
      <b style="color:#f5c542; font-size:0.85rem;">{c?.name}</b>
      <span style="font:700 0.7rem ui-monospace,monospace; color:#9fb0c0;">{c?.sym}</span>
    </div>
    <div style="font-size:0.72rem; color:#3fb6a8; margin-bottom:0.35rem;">
      Cost {CURRENCY}{c?.value} · Income {CURRENCY}{c?.revenue}/OR
    </div>
    <p style="margin:0; font-size:0.76rem; color:#cdd6df; line-height:1.4;">{c?.desc}</p>
  </div>
{/if}

<style>
  .wrap {
    display: inline-block;
  }
  .chip {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--bg);
    padding: 0.2rem 0.45rem;
    cursor: pointer;
    text-align: left;
    max-width: 100%;
  }
  .chip:hover {
    border-color: var(--rail-deep);
  }
  .cn {
    font-size: 0.72rem;
    color: var(--ink);
    line-height: 1.15;
  }
  .meta {
    font-size: 0.64rem;
    color: var(--rail);
    white-space: nowrap;
  }
</style>
