<script lang="ts">
  import { COMPANIES, CURRENCY } from '$lib/data/g1889';

  let { sym }: { sym: string } = $props();
  const c = COMPANIES.find((x) => x.sym === sym);
  let open = $state(false);
  let wrapEl: HTMLSpanElement;

  // Close when clicking outside this chip/popover.
  $effect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (wrapEl && !wrapEl.contains(e.target as Node)) open = false;
    };
    window.addEventListener('click', h);
    return () => window.removeEventListener('click', h);
  });
</script>

<span class="wrap" bind:this={wrapEl}>
  <button class="chip" onclick={() => (open = !open)} aria-expanded={open}>
    <b class="cn">{c?.name ?? sym}</b>
    <span class="meta">{CURRENCY}{c?.value} · +{CURRENCY}{c?.revenue}/OR</span>
  </button>
  {#if open}
    <div class="pop">
      <div class="poph"><b>{c?.name}</b><span class="sym">{c?.sym}</span></div>
      <div class="popm">Cost {CURRENCY}{c?.value} · Income {CURRENCY}{c?.revenue}/OR</div>
      <p>{c?.desc}</p>
    </div>
  {/if}
</span>

<style>
  .wrap {
    position: relative;
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
  .pop {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 30;
    width: 240px;
    background: #11202c;
    border: 1px solid var(--rail-deep);
    border-radius: 9px;
    padding: 0.55rem 0.65rem;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  }
  .poph {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 0.2rem;
  }
  .poph b {
    color: var(--rail);
    font-size: 0.85rem;
  }
  .poph .sym {
    font: 700 0.7rem ui-monospace, monospace;
    color: var(--muted);
  }
  .popm {
    font-size: 0.72rem;
    color: var(--accent);
    margin-bottom: 0.35rem;
  }
  .pop p {
    margin: 0;
    font-size: 0.76rem;
    color: #cdd6df;
    line-height: 1.4;
  }
</style>
