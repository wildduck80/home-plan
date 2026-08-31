import { writable, get } from 'svelte/store';
import { currentProject } from './project';
import { projectStore } from '$lib/services/datastore';
import { StorageQuotaError } from '$lib/services/storageErrors';
import { saveSnapshot } from '$lib/stores/versionHistory';

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error';

export const saveState = writable<SaveState>('saved');
export const lastSavedAt = writable<Date | null>(null);

export interface SaveFailure {
  /** `quota` means storage is full and the user must export to avoid losing work. */
  kind: 'quota' | 'unknown';
  message: string;
}

/**
 * Set when a save fails, cleared on the next success.
 *
 * A failed save is the one moment the user genuinely risks losing a house, so it must be
 * visible in the UI rather than only in the console.
 */
export const saveError = writable<SaveFailure | null>(null);

function describeFailure(error: unknown): SaveFailure {
  if (error instanceof StorageQuotaError) {
    return { kind: 'quota', message: error.message };
  }
  return {
    kind: 'unknown',
    message: error instanceof Error ? error.message : 'Unknown error while saving.',
  };
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let initialized = false;
let skipNext = false;

/** Call once to start watching project changes */
export function initAutoSave() {
  if (initialized) return;
  initialized = true;

  let first = true;
  currentProject.subscribe((_p) => {
    // Skip the initial subscription fire and loadProject calls
    if (first) { first = false; return; }
    if (skipNext) { skipNext = false; return; }
    if (!_p) return;
    markDirty();
  });
}

/** Mark project as dirty (unsaved). */
export function markDirty() {
  saveState.set('unsaved');
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    autoSave();
  }, 5000);
}

function captureThumbnail(projectId: string) {
  try {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement;
    if (!canvas) return;
    const size = 300;
    const tmp = document.createElement('canvas');
    tmp.width = size;
    tmp.height = Math.round(size * (canvas.height / canvas.width));
    const ctx = tmp.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(canvas, 0, 0, tmp.width, tmp.height);
    const dataUrl = tmp.toDataURL('image/jpeg', 0.6);
    projectStore.saveThumbnail(projectId, dataUrl);
  } catch {}
}

async function autoSave() {
  const p = get(currentProject);
  if (!p) return;
  saveState.set('saving');
  try {
    await projectStore.save(p);
    captureThumbnail(p.id);
    saveState.set('saved');
    saveError.set(null);
    lastSavedAt.set(new Date());
  } catch (e: unknown) {
    console.error('[AutoSave] Failed:', e);
    // Surface the failure instead of quietly reverting to 'unsaved': on a full quota,
    // every subsequent autosave will fail too, so the user needs to know now.
    saveState.set('error');
    saveError.set(describeFailure(e));
  }
}

/** Manual save */
export async function manualSave() {
  if (debounceTimer) clearTimeout(debounceTimer);
  const p = get(currentProject);
  if (!p) return;
  saveState.set('saving');
  try {
    await projectStore.save(p);
    captureThumbnail(p.id);
    saveSnapshot(p, 'Manual save');
    saveState.set('saved');
    saveError.set(null);
    lastSavedAt.set(new Date());
  } catch (e: unknown) {
    console.error('[Save] Failed:', e);
    saveState.set('error');
    saveError.set(describeFailure(e));
    throw e;
  }
}

/** Mark as saved without triggering dirty (e.g. after loadProject) */
export function markClean() {
  if (debounceTimer) clearTimeout(debounceTimer);
  saveState.set('saved');
  skipNext = true;
}
