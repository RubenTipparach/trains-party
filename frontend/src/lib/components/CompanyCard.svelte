<script lang="ts">
  import type { CompanyDef } from '$lib/data/types';
  import { CURRENCY } from '$lib/data/g1889';

  let { company }: { company: CompanyDef } = $props();
</script>

<div class="card">
  <div class="head">
    <span class="sym">{company.sym}</span>
    <span class="name">{company.name}</span>
    {#if company.minPlayers}<span class="badge">{company.minPlayers}+ players</span>{/if}
  </div>
  <div class="stats">
    <span><strong>{CURRENCY}{company.value}</strong> cost</span>
    <span><strong>{CURRENCY}{company.revenue}</strong> revenue</span>
  </div>
  <p class="desc">{company.desc}</p>
</div>

<style>
  .card {
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--bg-soft);
    padding: 0.8rem 0.9rem;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.4rem;
    flex-wrap: wrap;
  }
  .sym {
    font-weight: 700;
    color: var(--rail);
  }
  .name {
    font-weight: 600;
  }
  .badge {
    font-size: 0.68rem;
    color: var(--muted);
    border: 1px solid var(--line);
    border-radius: 999px;
    padding: 0.05rem 0.45rem;
  }
  .stats {
    display: flex;
    gap: 1rem;
    font-size: 0.85rem;
    color: var(--muted);
    margin-bottom: 0.4rem;
  }
  .stats strong {
    color: var(--ink);
  }
  .desc {
    margin: 0;
    font-size: 0.8rem;
    color: var(--muted);
    line-height: 1.4;
  }
</style>
