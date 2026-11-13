/**
 * DQ-999: the server names a passkey after its provider ("iCloud-Schlüsselbund") or, for an unknown AAGUID, just "Passkey". That
 * fallback is no name: a sentence never quotes it ("Der Passkey „Passkey“ …", "„Passkey“ entfernen?") and the rename field starts
 * empty instead of offering it. Shared with the HOME-02 security notice.
 */
const GENERIC_NAMES = new Set(['passkey']);

/** The passkey's own name, or null when it only carries the generic fallback. */
export function passkeyOwnName(name: string | null | undefined): string | null {
  const trimmed = name?.trim() ?? '';
  return trimmed === '' || GENERIC_NAMES.has(trimmed.toLocaleLowerCase('de-DE')) ? null : trimmed;
}
