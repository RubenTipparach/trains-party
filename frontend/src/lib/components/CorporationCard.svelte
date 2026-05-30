<script lang="ts">
  import type { CorporationDef } from '$lib/data/types';
  import { LOCATION_NAMES } from '$lib/data/map1889';
  import { CURRENCY } from '$lib/data/g1889';

  let { corp }: { corp: CorporationDef } = $props();
</script>

<div class="card" style="--corp:{corp.color}">
  <div class="head">
    <span class="sym">{corp.sym}</span>
    <span class="name">{corp.name}</span>
  </div>
  <dl>
    <div><dt>Home</dt><dd>{corp.coordinates}{LOCATION_NAMES[corp.coordinates] ? ` · ${LOCATION_NAMES[corp.coordinates]}` : ''}</dd></div>
    <div><dt>Tokens</dt><dd>{corp.tokens.length} ({corp.tokens.map((t) => (t === 0 ? 'free' : `${CURRENCY}${t}`)).join(', ')})</dd></div>
    <div><dt>Float</dt><dd>{corp.floatPercent}%</dd></div>
  </dl>
</div>

<style>
  .card {
    border: 1px solid var(--line);
    border-left: 6px solid var(--corp);
    border-radius: 12px;
    background: var(--bg-soft);
    padding: 0.8rem 0.9rem;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin-bottom: 0.5rem;
  }
  .sym {
    display: inline-grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: var(--corp);
    color: #fff;
    font-weight: 700;
    font-size: 0.8rem;
    flex: none;
  }
  .name {
    font-weight: 600;
    line-height: 1.15;
  }
  dl {
    margin: 0;
    display: grid;
    gap: 0.2rem;
  }
  dl div {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    font-size: 0.82rem;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    text-align: right;
  }
</style>
