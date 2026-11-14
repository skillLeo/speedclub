/**
 * Android widget "Mein Auto" (ADR-454): where the snapshot and the car's photo live. Both sit in the app's own documents folder
 * (`widget/`), which only this app can read and the system does not purge like the cache; the widget's headless task runs in this
 * app's process and reads them from there. Sign-out deletes the folder's contents.
 */
import { Directory, File, Paths } from 'expo-file-system';

import { parseSnapshot, type WidgetSnapshot } from './snapshot';

export const WIDGET_DIR = 'widget';
export const SNAPSHOT_FILE = 'mein-auto.json';

export function widgetDirectory(): Directory {
  return new Directory(Paths.document, WIDGET_DIR);
}

function ensureDirectory(): Directory {
  const directory = widgetDirectory();
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

export async function readSnapshot(): Promise<WidgetSnapshot | null> {
  try {
    const file = new File(widgetDirectory(), SNAPSHOT_FILE);
    if (!file.exists) return null;
    return parseSnapshot(await file.text());
  } catch {
    return null;
  }
}

/** Written next to the target, then moved over it: the widget never reads half a file. */
export async function writeSnapshot(snapshot: WidgetSnapshot): Promise<void> {
  const directory = ensureDirectory();
  const temp = new File(directory, `${SNAPSHOT_FILE}.tmp`);
  temp.create({ overwrite: true });
  await temp.write(JSON.stringify(snapshot));
  await temp.move(new File(directory, SNAPSHOT_FILE), { overwrite: true });
}

/** The snapshot and every photo, except the files named in `keep` (URIs). */
export function removeWidgetFiles(keep: readonly string[] = []): void {
  const directory = widgetDirectory();
  if (!directory.exists) return;
  for (const entry of directory.list()) {
    if (keep.includes(entry.uri)) continue;
    try {
      entry.delete();
    } catch (error) {
      console.warn('Could not remove a widget file', error);
    }
  }
}

/** Every photo but `keep`; the snapshot stays. */
export function prunePhotos(keep: string | null): void {
  removeWidgetFiles([new File(widgetDirectory(), SNAPSHOT_FILE).uri, ...(keep ? [keep] : [])]);
}

export function photoFile(name: string): File {
  return new File(ensureDirectory(), name);
}

export function fileExists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}
