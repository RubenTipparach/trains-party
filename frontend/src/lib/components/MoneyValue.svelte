<script lang="ts">
  import { anim } from '$lib/game/anim.svelte';
  import { game } from '$lib/game/sandbox.svelte';
  import { currencyFor } from '$lib/engine';

  // Displays a cash value and pops a floating +/- delta when it changes.
  let { value }: { value: number } = $props();
  const CURRENCY = $derived(currencyFor(game.title));

  let shown = $state(0);
  let prev: number | null = null;
  let delta = $state<number | null>(null);
  let deltaMs = $state(1100);
  let key = $state(0);

  $effect(() => {
    const v = value;
    if (prev === null) {
      prev = v;
      shown = v;
      return;
    }
    if (v !== prev) {
      const d = v - prev;
      prev = v;
      shown = v;
      if (anim.on && d !== 0) {
        delta = d;
        deltaMs = anim.scale(1100); // shorten with the watch speed so it keeps up
        key += 1;
        const k = key;
        setTimeout(() => {
          if (key === k) delta = null;
        }, deltaMs);
      } else {
        delta = null;
      }
    }
  });
</script>

<span class="wrap">
  {CURRENCY}{shown}
  {#if delta !== null}
    {#key key}
      <span class="delta" class:up={delta > 0} class:down={delta < 0} style="--floatdur:{deltaMs}ms">
        {delta > 0 ? '+' : '−'}{CURRENCY}{Math.abs(delta)}
      </span>
    {/key}
  {/if}
</span>

<style>
  .wrap {
    position: relative;
    display: inline-block;
  }
  .delta {
    position: absolute;
    left: 50%;
    bottom: 100%;
    transform: translateX(-50%);
    font-size: 0.72rem;
    font-weight: 700;
    white-space: nowrap;
    pointer-events: none;
    animation: floatup var(--floatdur, 1.1s) ease-out forwards;
  }
  .delta.up {
    color: #5fd39b;
  }
  .delta.down {
    color: #ff8a7e;
  }
  @keyframes floatup {
    0% {
      opacity: 0;
      transform: translate(-50%, 4px);
    }
    20% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translate(-50%, -18px);
    }
  }
</style>
