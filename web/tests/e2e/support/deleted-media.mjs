// Photos a spec deletes on purpose, across workers. A page of another worker that listed the build a moment before (Start,
// Discover) loads its photo after the deletion and gets the server's correct 404 (verify of 2026-11-08: nav-shared-routes
// while f8 deleted an account with a published build). The page-error fixture lets exactly these files' 404 through, nothing
// else: a spec notes its build's photos right before it deletes the build or the account, never earlier.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = join(tmpdir(), 'speedclub-e2e-deleted-media');
const ULID = /^[0-9a-hjkmnp-tv-z]{26}$/i;

/** The media ids of /storage/media/{id}/… */
export const MEDIA_PATH = /\/storage\/media\/([0-9A-Za-z]{26})\//;

/**
 * @param {{ photos?: Array<{ id: string }> } | Array<{ id: string }>} build a buildVehicle result, or its photos
 */
export function noteDeletedMedia(build) {
  const photos = Array.isArray(build) ? build : (build.photos ?? []);
  mkdirSync(DIR, { recursive: true });
  for (const { id } of photos) {
    if (!ULID.test(id)) throw new Error(`noteDeletedMedia: not a media id: ${id}`);
    writeFileSync(join(DIR, id.toLowerCase()), '');
  }
}

/** @param {string} id */
export function isDeletedMedia(id) {
  return ULID.test(id) && existsSync(join(DIR, id.toLowerCase()));
}

/** A run starts with none (global setup). */
export function clearDeletedMedia() {
  rmSync(DIR, { recursive: true, force: true });
}
