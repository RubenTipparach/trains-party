<script lang="ts">
  import { TRAINS, CURRENCY } from '$lib/data/g1889';
</script>

<div class="roster">
  {#each TRAINS as t (t.name)}
    <div class="train">
      <span class="name">{t.name}</span>
      <span class="price">{CURRENCY}{t.price}</span>
      <span class="meta">×{t.num === -1 ? '∞' : t.num}</span>
      {#if t.rustsOn}
        <span class="rust">rusts on {t.rustsOn}</span>
      {:else if t.closesCompanies}
        <span class="rust">closes privates</span>
      {:else if t.availableOn}
        <span class="rust">from phase {t.availableOn}</span>
      {:else}
        <span class="rust">&nbsp;</span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .roster {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  .train {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 84px;
    padding: 0.7rem 0.6rem;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-soft);
    transition: transform 160ms ease, border-color 160ms ease;
  }
  .train:hover {
    transform: translateY(-3px);
    border-color: var(--rail-deep);
  }
  .name {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--rail);
  }
  .price {
    font-weight: 600;
  }
  .meta {
    font-size: 0.8rem;
    color: var(--muted);
  }
  .rust {
    font-size: 0.7rem;
    color: var(--muted);
    margin-top: 0.2rem;
    text-align: center;
  }
</style>
