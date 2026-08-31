import type { Project } from '$lib/models/types';
import { parseProjectJson, serializeProjectCompact } from '$lib/persistence/projectIo';
import { isQuotaExceededError, StorageQuotaError } from './storageErrors';

export interface DataStore {
  save(project: Project): Promise<void>;
  load(id: string): Promise<Project | null>;
  list(): Promise<{ id: string; name: string; updatedAt: string }[]>;
  delete(id: string): Promise<void>;
  duplicate(id: string): Promise<Project | null>;
  saveThumbnail(id: string, dataUrl: string): void;
  getThumbnail(id: string): string | null;
}

const KEY = 'floorplan_projects';
const THUMB_PREFIX = 'floorplan_thumb_';

function thumbKey(id: string): string {
  return `${THUMB_PREFIX}${id}`;
}

function getAll(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

/**
 * Drop cached project thumbnails to reclaim space, keeping the one for `exceptId` if
 * possible so the project being saved still has a preview.
 *
 * Thumbnails are derived data — re-captured from the canvas on the next save — so they are
 * the only thing this store may discard without asking. Returns how many were removed.
 */
function pruneThumbnails(exceptId: string): number {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(THUMB_PREFIX) && key !== thumbKey(exceptId)) keys.push(key);
  }

  for (const key of keys) {
    try { localStorage.removeItem(key); } catch { /* nothing more we can do */ }
  }

  return keys.length;
}

export const localStore: DataStore = {
  async save(project) {
    const all = getAll();
    all[project.id] = serializeProjectCompact(project);
    const payload = JSON.stringify(all);

    try {
      localStorage.setItem(KEY, payload);
      return;
    } catch (e: unknown) {
      if (!isQuotaExceededError(e)) throw e;
    }

    // Storage is full. Reclaim only *regenerable* data — thumbnails are re-captured from
    // the canvas on the next save — and never another project. The baseline implementation
    // deleted every other project here, which silently destroyed the user's work.
    console.warn('[DataStore] Storage full; pruning cached thumbnails to make room.');
    const reclaimed = pruneThumbnails(project.id);

    if (reclaimed > 0) {
      try {
        localStorage.setItem(KEY, payload);
        return;
      } catch (e: unknown) {
        if (!isQuotaExceededError(e)) throw e;
      }
    }

    // Nothing safe left to give up. Fail loudly and leave stored projects untouched, so the
    // in-memory project can still be exported.
    console.error('[DataStore] Could not save project: storage quota exhausted.');
    throw new StorageQuotaError(project.id, payload.length);
  },

  async load(id) {
    const all = getAll();
    const raw = all[id];
    if (!raw) return null;
    // Version detection, migration, date revival and floor normalization all happen in
    // the shared pipeline — this loader must not re-implement any of it (HP-102).
    return parseProjectJson(raw);
  },

  async list() {
    const all = getAll();
    // Deliberately a shallow metadata read rather than a full load: the project list must
    // stay cheap. One unreadable entry is skipped with a warning instead of taking down
    // the whole list — the user can still open and export their other projects.
    const entries: { id: string; name: string; updatedAt: string }[] = [];
    for (const [key, raw] of Object.entries(all)) {
      try {
        const p = JSON.parse(raw as string);
        entries.push({ id: p.id ?? key, name: p.name ?? 'Untitled Project', updatedAt: p.updatedAt });
      } catch (e: unknown) {
        console.warn(`[DataStore] Skipping unreadable project "${key}" in project list`, e);
      }
    }
    return entries;
  },

  async delete(id) {
    const all = getAll();
    delete all[id];
    localStorage.setItem(KEY, JSON.stringify(all));
    // Also remove thumbnail
    try { localStorage.removeItem(thumbKey(id)); } catch {}
  },

  async duplicate(id: string): Promise<Project | null> {
    const original = await this.load(id);
    if (!original) return null;
    const newId = Math.random().toString(36).slice(2, 10);
    const dup: Project = {
      ...original,
      id: newId,
      name: `${original.name} (Copy)`,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.save(dup);
    // Copy thumbnail if exists
    try {
      const thumb = localStorage.getItem(thumbKey(id));
      if (thumb) localStorage.setItem(thumbKey(newId), thumb);
    } catch {}
    return dup;
  },

  saveThumbnail(id: string, dataUrl: string) {
    try { localStorage.setItem(thumbKey(id), dataUrl); } catch {}
  },

  getThumbnail(id: string): string | null {
    try { return localStorage.getItem(thumbKey(id)); } catch { return null; }
  },
};
