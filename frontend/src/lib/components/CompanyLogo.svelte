<script lang="ts">
  // Company logos for Railways of the Lost Atlas, drawn to match the rulebook's
  // silkscreened icons (p.3): an emblem per minor, tinted with the company colour.
  // Majors fall back to their initial. Everything is a simple 24x24 line/fill icon.
  let { sym, color = 'currentColor', size = 22 }: { sym: string; color?: string; size?: number } = $props();
</script>

<svg class="logo" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
  <!-- white disc so the glyph stays readable on any (often coloured) background -->
  <circle cx="12" cy="12" r="11.3" fill="#fbfaf6" stroke="rgba(20,18,14,0.3)" stroke-width="1" />
  <g
    transform="translate(12 12) scale(0.78) translate(-12 -12)"
    fill="none"
    stroke={color}
    stroke-width="2.1"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    {#if sym === 'AD'}
    <!-- Adaptive: asterisk / flower burst -->
    <line x1="12" y1="4" x2="12" y2="20" />
    <line x1="5" y1="8" x2="19" y2="16" />
    <line x1="5" y1="16" x2="19" y2="8" />
    <circle cx="12" cy="12" r="2.3" fill={color} stroke="none" />
  {:else if sym === 'AG'}
    <!-- Agricultural: wheat stalk -->
    <line x1="12" y1="21" x2="12" y2="7" />
    <path d="M12 9q4 -1 5 -4" /><path d="M12 9q-4 -1 -5 -4" />
    <path d="M12 13q4 -1 5 -4" /><path d="M12 13q-4 -1 -5 -4" />
    <path d="M12 17q4 -1 5 -4" /><path d="M12 17q-4 -1 -5 -4" />
  {:else if sym === 'BR'}
    <!-- Bridging: arched bridge -->
    <path d="M3 14q9 -10 18 0" />
    <line x1="3" y1="14" x2="21" y2="14" />
    <line x1="3" y1="14" x2="3" y2="19" /><line x1="21" y1="14" x2="21" y2="19" />
    <line x1="9" y1="11" x2="9" y2="14" /><line x1="15" y1="11" x2="15" y2="14" />
  {:else if sym === 'EM'}
    <!-- Eastern Mining: crossed pickaxes -->
    <line x1="6" y1="19" x2="17" y2="6" /><path d="M13 4q5 0 5 6" />
    <line x1="18" y1="19" x2="7" y2="6" /><path d="M11 4q-5 0 -5 6" />
  {:else if sym === 'EA'}
    <!-- Expansive: firework burst -->
    {#each [0, 45, 90, 135, 180, 225, 270, 315] as a}
      <line x1="12" y1="12" x2={12 + 8 * Math.cos((a * Math.PI) / 180)} y2={12 + 8 * Math.sin((a * Math.PI) / 180)} />
    {/each}
    <circle cx="12" cy="12" r="1.6" fill={color} stroke="none" />
  {:else if sym === 'ER'}
    <!-- Express: chevrons -->
    <polyline points="6,6 13,12 6,18" stroke-width="2.3" />
    <polyline points="12,6 19,12 12,18" stroke-width="2.3" />
  {:else if sym === 'NP'}
    <!-- Northern Port: anchor -->
    <circle cx="12" cy="5" r="2" />
    <line x1="12" y1="7" x2="12" y2="19" />
    <line x1="8" y1="11" x2="16" y2="11" />
    <path d="M5 14q0 5 7 5q7 0 7 -5" />
  {:else if sym === 'OV'}
    <!-- Overnight: crescent moon + star -->
    <path d="M17 4a8 8 0 1 0 0 16a6 6 0 1 1 0 -16z" fill={color} stroke="none" />
    <circle cx="7.5" cy="8" r="1.4" fill={color} stroke="none" />
  {:else if sym === 'RE'}
    <!-- Resourceful: cut gem -->
    <path d="M6 9l3 -4h6l3 4l-6 11z" />
    <line x1="6" y1="9" x2="18" y2="9" />
    <line x1="9" y1="5" x2="11" y2="9" /><line x1="15" y1="5" x2="13" y2="9" />
    <line x1="11" y1="9" x2="12" y2="20" /><line x1="13" y1="9" x2="12" y2="20" />
  {:else if sym === 'SP'}
    <!-- Spacious: compass rose -->
    <path d="M12 3l2 7 -2 2 -2 -2z" fill={color} stroke="none" />
    <path d="M12 21l2 -7 -2 -2 -2 2z" fill={color} stroke="none" />
    <path d="M3 12l7 2 2 -2 -2 -2z" fill={color} stroke="none" />
    <path d="M21 12l-7 2 -2 -2 2 -2z" fill={color} stroke="none" />
  {:else if sym === 'SU'}
    <!-- Suburban: rooftops -->
    <polyline points="3,13 8,8 13,13" />
    <polyline points="11,14 16,9 21,14" />
    <line x1="3" y1="13" x2="3" y2="19" /><line x1="13" y1="13" x2="13" y2="19" />
    <line x1="11" y1="14" x2="11" y2="19" /><line x1="21" y1="14" x2="21" y2="19" />
    <line x1="3" y1="19" x2="21" y2="19" />
  {:else if sym === 'TU'}
    <!-- Tunneling: tunnel portal -->
    <path d="M4 19v-5a8 8 0 0 1 16 0v5" />
    <path d="M9 19v-4a3 3 0 0 1 6 0v4" />
    <line x1="11" y1="19" x2="11" y2="22" /><line x1="13" y1="19" x2="13" y2="22" />
  {:else}
      <!-- Fallback: the company initial(s) -->
      <text x="12" y="16" text-anchor="middle" font-size="11" font-weight="800" fill={color} stroke="none">{sym}</text>
    {/if}
  </g>
</svg>

<style>
  .logo {
    display: block;
    flex: none;
  }
</style>
