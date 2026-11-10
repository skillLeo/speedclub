/**
 * SET-05: the ten recovery codes leave the app only when the member asks: copied, or saved as a text file. On web the file is a
 * Blob the browser downloads; native writes it to the cache only for the share sheet ("In Dateien sichern") and deletes it
 * right after. Nothing is logged and nothing is stored anywhere else.
 */
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { isWeb } from '@/lib/platform';

export const RECOVERY_FILE_NAME = 'speedclub-wiederherstellungscodes.txt';
/** How long the download's object URL stays valid after the click. */
export const REVOKE_DELAY_MS = 60 * 1000;

/** The file's text: a heading, a line on how to use them, the codes one per line. */
export function recoveryCodesText(codes: readonly string[], heading: string, usage: string): string {
  return [heading, '', usage, '', ...codes, ''].join('\n');
}

/** Two groups of a code for reading aloud and typing, "ABCD EFGH"; the dash the server may print stays. */
export function groupSecret(secret: string): string {
  return secret.replace(/\s/g, '').replace(/(.{4})(?=.)/g, '$1 ');
}

export async function copyText(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
}

type WebDocument = {
  createElement: (tag: 'a') => { href: string; download: string; rel: string; click: () => void; remove: () => void };
  body: { appendChild: (node: unknown) => void };
};
type WebUrl = { createObjectURL: (blob: Blob) => string; revokeObjectURL: (url: string) => void };

/** Saves the text as a file: a download on web, the share sheet on native. Resolves once the browser or the sheet took it. */
export async function saveTextFile(text: string, fileName: string, dialogTitle: string): Promise<void> {
  if (isWeb) {
    const doc = (globalThis as unknown as { document?: WebDocument }).document;
    const url = (globalThis as unknown as { URL: WebUrl }).URL;
    if (!doc) throw new Error('No document to download into');
    const href = url.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = doc.createElement('a');
    link.href = href;
    link.download = fileName;
    link.rel = 'noopener';
    doc.body.appendChild(link);
    link.click();
    link.remove();
    // Safari and Firefox read the object URL after click() returns; revoking it at once can cancel the download.
    setTimeout(() => url.revokeObjectURL(href), REVOKE_DELAY_MS);
    return;
  }
  const file = new File(Paths.cache, fileName);
  try {
    file.create({ overwrite: true });
    await file.write(text);
    await Sharing.shareAsync(file.uri, { mimeType: 'text/plain', UTI: 'public.plain-text', dialogTitle });
  } finally {
    if (file.exists) file.delete();
  }
}
