<script lang="ts">
  import { activeFloor, calibrationMode, calibrationPoints, updateBackgroundImage } from '$lib/stores/project';
  import {
    computeCalibration,
    formatCalibratedDistance,
    measureWorldDistance,
    parseKnownDistance
  } from '$lib/import/reference/calibration';
  import type { Floor, Point } from '$lib/models/types';

  /**
   * Scale calibration panel (HP-303).
   *
   * Deliberately a floating panel rather than a modal: the user needs to keep panning and
   * zooming the canvas while placing points, which a modal would block. It replaces a
   * `window.prompt()` that offered no preview, no way to fix a misplaced point, and no cancel.
   */

  // All state is declared before any subscription. Svelte stores invoke their subscriber
  // *synchronously* on subscribe, so a callback that touched state declared further down would
  // hit the temporal dead zone and throw during mount — which takes the whole editor page with
  // it, showing only "Loading…".
  let floor = $state<Floor | null>(null);
  let points: Point[] = $state([]);
  let active = $state(false);
  let distanceText = $state('');
  let applyError: string | null = $state(null);
  let inputEl: HTMLInputElement | null = $state(null);

  function reset() {
    distanceText = '';
    applyError = null;
  }

  activeFloor.subscribe((f) => { floor = f; });
  calibrationPoints.subscribe((p) => { points = p; });
  calibrationMode.subscribe((v) => {
    active = v;
    if (!v) reset();
  });

  function cancel() {
    calibrationPoints.set([]);
    calibrationMode.set(false);
  }

  function restart() {
    calibrationPoints.set([]);
    reset();
  }

  const background = $derived(floor?.backgroundImage ?? null);
  const hasBothPoints = $derived(points.length === 2);
  const measured = $derived(hasBothPoints ? measureWorldDistance(points[0], points[1]) : 0);
  const parsed = $derived(parseKnownDistance(distanceText));
  /** Split out because TypeScript cannot narrow a union through `$derived` in markup. */
  const parsedCm = $derived(parsed.ok ? parsed.cm : null);
  const parseError = $derived(parsed.ok ? null : parsed.error);

  /** Live preview of the scale the current input would produce. */
  const preview = $derived.by(() => {
    if (!hasBothPoints || !background || parsedCm === null) return null;
    try {
      return computeCalibration({
        pointA: points[0],
        pointB: points[1],
        knownDistanceCm: parsedCm,
        currentScale: background.scale,
        currentPosition: background.position
      });
    } catch {
      // Invalid geometry is reported through `geometryError` instead; the preview just hides.
      return null;
    }
  });

  /** Problems with the two points themselves, shown before the user types anything. */
  const geometryError = $derived.by(() => {
    if (!hasBothPoints || !background) return null;
    try {
      computeCalibration({
        pointA: points[0],
        pointB: points[1],
        knownDistanceCm: 100,
        currentScale: background.scale,
        currentPosition: background.position
      });
      return null;
    } catch (e: unknown) {
      return e instanceof Error ? e.message : 'Those two points cannot be used.';
    }
  });

  // Focus the input as soon as the second point lands, so the user can type straight away.
  $effect(() => {
    if (hasBothPoints && inputEl) inputEl.focus();
  });

  function apply() {
    if (!background || !hasBothPoints || parsedCm === null) return;

    try {
      const result = computeCalibration({
        pointA: points[0],
        pointB: points[1],
        knownDistanceCm: parsedCm,
        currentScale: background.scale,
        currentPosition: background.position
      });

      updateBackgroundImage({
        scale: result.scale,
        position: result.position,
        calibration: {
          knownDistanceCm: parsedCm,
          pointA: points[0],
          pointB: points[1],
          calibratedAt: new Date().toISOString()
        }
      });

      calibrationPoints.set([]);
      calibrationMode.set(false);
    } catch (e: unknown) {
      applyError = e instanceof Error ? e.message : 'Could not apply this calibration.';
      console.error('[Calibration] apply failed', e);
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (!active) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      cancel();
    }
    if (e.key === 'Enter' && hasBothPoints && parsedCm !== null && !geometryError) {
      e.stopPropagation();
      apply();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if active}
  <!-- Bottom-centre, clear of the properties panel and the canvas area being measured. -->
  <div
    class="absolute bottom-20 left-1/2 -translate-x-1/2 z-40 w-[26rem] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden"
    role="group"
    aria-label="Scale calibration"
  >
    <div class="px-4 py-2.5 bg-slate-800 text-white flex items-center gap-2">
      <span class="text-sm font-semibold">Set the plan scale</span>
      <button
        class="ml-auto text-white/60 hover:text-white text-sm"
        onclick={cancel}
        aria-label="Cancel calibration"
      >Esc ✕</button>
    </div>

    {#if !background}
      <p class="px-4 py-4 text-sm text-gray-600">
        Import a floor plan reference first — there is nothing to calibrate.
      </p>
    {:else}
      <div class="px-4 py-3.5">
        <!-- Step 1: place the points -->
        <div class="flex items-center gap-2 text-sm">
          <span
            class="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 {points.length >= 1 ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-500'}"
          >A</span>
          <span
            class="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 {points.length >= 2 ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-500'}"
          >B</span>
          <span class="text-gray-600">
            {#if points.length === 0}
              Click the start of a dimension you know.
            {:else if points.length === 1}
              Now click the other end.
            {:else}
              Span measured. Zoom and click again to re-place.
            {/if}
          </span>
          {#if points.length > 0}
            <button class="ml-auto text-xs text-blue-600 hover:underline shrink-0" onclick={restart}>
              Reset
            </button>
          {/if}
        </div>

        <p class="text-xs text-gray-400 mt-1.5">
          Pick the longest dimension on the sheet — a short span turns a small click error into a
          large scale error.
        </p>

        {#if geometryError}
          <p class="mt-2.5 text-xs text-red-600" role="alert">{geometryError}</p>
        {/if}

        <!-- Step 2: the known distance -->
        {#if hasBothPoints && !geometryError}
          <label class="block mt-3.5">
            <span class="text-xs font-medium text-gray-600">How far apart is that, really?</span>
            <input
              bind:this={inputEl}
              bind:value={distanceText}
              type="text"
              inputmode="decimal"
              placeholder="e.g. 1120, or 11.2 m"
              class="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-blue-500"
            />
          </label>

          {#if distanceText !== '' && parseError}
            <p class="mt-1.5 text-xs text-amber-600">{parseError}</p>
          {/if}

          <!-- Step 3: preview before committing -->
          {#if preview}
            <div class="mt-3 p-2.5 bg-gray-50 rounded-lg text-xs text-gray-600 space-y-1">
              <div class="flex justify-between">
                <span>Measured on screen</span>
                <span class="font-medium text-gray-800">{measured.toFixed(1)} units</span>
              </div>
              <div class="flex justify-between">
                <span>You entered</span>
                <span class="font-medium text-gray-800">{formatCalibratedDistance(parsedCm ?? 0)}</span>
              </div>
              <div class="flex justify-between">
                <span>Reference will resize</span>
                <span class="font-medium {Math.abs(preview.ratio - 1) < 0.001 ? 'text-gray-800' : 'text-blue-700'}">
                  ×{preview.ratio.toFixed(4)}
                </span>
              </div>
            </div>
          {/if}

          {#if applyError}
            <p class="mt-2 text-xs text-red-600" role="alert">{applyError}</p>
          {/if}
        {/if}
      </div>

      <div class="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center gap-2">
        {#if background.calibration}
          <span class="text-[11px] text-gray-400">
            Currently set from {formatCalibratedDistance(background.calibration.knownDistanceCm)}
          </span>
        {/if}
        <button
          class="ml-auto px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900"
          onclick={cancel}
        >Cancel</button>
        <button
          class="px-4 py-1.5 bg-blue-500 text-white rounded-lg text-sm font-semibold hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed"
          onclick={apply}
          disabled={!preview || !!geometryError}
        >Apply scale</button>
      </div>
    {/if}
  </div>
{/if}
