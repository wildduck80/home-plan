<script lang="ts">
  import { RESOLUTION_PRESETS } from '$lib/import/pdf/renderPlan';
  import type { LoadedPdf, PdfPageDescriptor } from '$lib/import/pdf/pdfDocument';

  /**
   * Page picker for importing a PDF sheet as a floor-plan reference (HP-301).
   *
   * A real permit set puts the drawings at the *end* of a long document — pages 28-36 of 36 in
   * the set this was built against — so choosing a page is the whole job, not a nicety.
   * Pages that look like drawings are flagged, and the first one is preselected.
   */

  let {
    open = $bindable(false),
    file = null,
    onImport
  }: {
    open: boolean;
    file: File | null;
    onImport: (dataUrl: string, snapSegments: { x1: number; y1: number; x2: number; y2: number }[]) => void;
  } = $props();

  let doc: LoadedPdf | null = $state(null);
  let pages: PdfPageDescriptor[] = $state([]);
  let thumbnails: Record<number, string> = $state({});
  let selectedPage = $state(1);
  let targetLongEdgePx = $state(
    RESOLUTION_PRESETS.find((preset) => preset.isDefault)!.longEdgePx
  );

  let loading = $state(false);
  let rendering = $state(false);
  let error: string | null = $state(null);
  /** Guards against a slow load finishing after the dialog moved on to another file. */
  let loadToken = 0;

  $effect(() => {
    if (open && file) void loadDocument(file);
    if (!open) void teardown();
  });

  async function loadDocument(source: File) {
    const token = ++loadToken;
    loading = true;
    error = null;
    thumbnails = {};
    pages = [];

    try {
      const { loadPdf } = await import('$lib/import/pdf/pdfDocument');
      const loaded = await loadPdf(source);
      if (token !== loadToken) {
        await loaded.destroy();
        return;
      }

      doc = loaded;
      pages = loaded.pages;
      // Open on the first page that looks like a drawing rather than page 1, which in a permit
      // set is a cover sheet.
      selectedPage = loaded.pages.find((page) => page.isLikelyDrawing)?.pageNumber ?? 1;
      loading = false;

      await renderThumbnails(token, loaded);
    } catch (e: unknown) {
      if (token !== loadToken) return;
      loading = false;
      error = e instanceof Error ? e.message : 'Could not read this PDF.';
      console.error('[PdfImport] load failed', e);
    }
  }

  /** Render previews one at a time so a 36-page document does not freeze the UI. */
  async function renderThumbnails(token: number, loaded: LoadedPdf) {
    for (const page of loaded.pages) {
      if (token !== loadToken) return;
      try {
        const dataUrl = await loaded.renderThumbnail(page.pageNumber);
        if (token !== loadToken) return;
        thumbnails = { ...thumbnails, [page.pageNumber]: dataUrl };
      } catch (e: unknown) {
        // A single unrenderable page must not stop the rest of the picker appearing.
        console.warn(`[PdfImport] thumbnail for page ${page.pageNumber} failed`, e);
      }
      // Yield to the event loop so clicks stay responsive while previews stream in.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  async function teardown() {
    loadToken++;
    const current = doc;
    doc = null;
    pages = [];
    thumbnails = {};
    error = null;
    loading = false;
    rendering = false;
    if (current) await current.destroy();
  }

  async function confirmImport() {
    if (!doc || rendering) return;
    rendering = true;
    error = null;

    try {
      const result = await doc.renderPage(selectedPage, targetLongEdgePx);
      onImport(result.dataUrl, result.snapSegments);
      open = false;
    } catch (e: unknown) {
      error = e instanceof Error ? e.message : 'Could not render this page.';
      console.error('[PdfImport] render failed', e);
    } finally {
      rendering = false;
    }
  }

  const selectedDescriptor = $derived(
    pages.find((page) => page.pageNumber === selectedPage) ?? null
  );
  const drawingCount = $derived(pages.filter((page) => page.isLikelyDrawing).length);
</script>

<!-- Bound to the window, not the overlay: the overlay never receives focus, so a keydown
     handler on it would only fire if the user happened to click it first. -->
<svelte:window
  onkeydown={(e) => {
    if (open && e.key === 'Escape') {
      e.stopPropagation();
      open = false;
    }
  }}
/>

{#if open}
  <div
    class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6"
    role="dialog"
    aria-modal="true"
    aria-label="Import PDF floor plan"
  >
    <div class="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-full flex flex-col overflow-hidden">
      <div class="px-5 py-4 border-b border-gray-200 flex items-center gap-3 shrink-0">
        <div>
          <h2 class="font-semibold text-gray-800">Import floor plan from PDF</h2>
          <p class="text-xs text-gray-500 mt-0.5">
            {#if file}{file.name}{/if}
            {#if pages.length > 0}
              · {pages.length} page{pages.length === 1 ? '' : 's'}
              {#if drawingCount > 0 && drawingCount < pages.length}
                · {drawingCount} look like drawings
              {/if}
            {/if}
          </p>
        </div>
        <button
          class="ml-auto text-gray-400 hover:text-gray-700 text-xl leading-none"
          onclick={() => (open = false)}
          aria-label="Close"
        >✕</button>
      </div>

      {#if error}
        <div class="mx-5 mt-4 px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg" role="alert">
          {error}
        </div>
      {/if}

      <div class="flex-1 overflow-y-auto p-5">
        {#if loading}
          <p class="text-sm text-gray-500 py-8 text-center">Reading PDF…</p>
        {:else if pages.length === 0 && !error}
          <p class="text-sm text-gray-500 py-8 text-center">No pages found.</p>
        {:else}
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {#each pages as page (page.pageNumber)}
              <button
                class="border-2 rounded-lg p-2 text-left transition-colors {selectedPage === page.pageNumber
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-blue-300'}"
                onclick={() => (selectedPage = page.pageNumber)}
                aria-pressed={selectedPage === page.pageNumber}
              >
                <div class="aspect-[3/4] bg-gray-50 rounded flex items-center justify-center overflow-hidden mb-2">
                  {#if thumbnails[page.pageNumber]}
                    <img src={thumbnails[page.pageNumber]} alt="Page {page.pageNumber}" class="max-w-full max-h-full object-contain" />
                  {:else}
                    <span class="text-[10px] text-gray-400">…</span>
                  {/if}
                </div>
                <div class="text-xs font-medium text-gray-700 flex items-center gap-1">
                  Page {page.pageNumber}
                  {#if page.isLikelyDrawing}
                    <span class="text-[9px] font-semibold text-blue-600 bg-blue-100 px-1 rounded" title="Contains substantial line work">PLAN</span>
                  {/if}
                </div>
                <div class="text-[10px] text-gray-400">{page.sizeLabel}</div>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="px-5 py-4 border-t border-gray-200 shrink-0 flex items-end gap-4 flex-wrap">
        <div>
          <div class="text-xs font-medium text-gray-600 mb-1.5">Resolution</div>
          <div class="flex gap-1.5">
            {#each RESOLUTION_PRESETS as preset (preset.longEdgePx)}
              <button
                class="px-3 py-1.5 text-xs rounded-lg border transition-colors {targetLongEdgePx === preset.longEdgePx
                  ? 'border-blue-500 bg-blue-50 text-blue-700 font-semibold'
                  : 'border-gray-200 text-gray-600 hover:border-blue-300'}"
                onclick={() => (targetLongEdgePx = preset.longEdgePx)}
                title={preset.description}
              >{preset.label}</button>
            {/each}
          </div>
        </div>

        {#if selectedDescriptor}
          <p class="text-xs text-gray-400 flex-1 min-w-40">
            Importing page {selectedPage} · {selectedDescriptor.sizeLabel}.
            You'll set the real-world scale next using a known dimension.
          </p>
        {/if}

        <button
          class="px-5 py-2.5 bg-blue-500 text-white rounded-lg font-semibold text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed ml-auto"
          onclick={confirmImport}
          disabled={rendering || loading || pages.length === 0}
        >
          {rendering ? 'Rendering…' : 'Import page'}
        </button>
      </div>
    </div>
  </div>
{/if}
