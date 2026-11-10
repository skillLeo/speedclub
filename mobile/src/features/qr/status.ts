import type { QrCodeData } from '@/api/queries/qr';

/** What QR-01 and QR-02 say about a code. */
export type QrRowStatus = 'active' | 'private' | 'blocked' | 'none';

/**
 * `blocked`: the newest code is revoked, which for a vehicle in the garage only happens when staff took it down (ADR-148 e);
 * a member's own reissue always leaves a new active code. `private`: a scan reads "Dieses Fahrzeug ist privat".
 */
export function qrRowStatus(qr: Pick<QrCodeData, 'status' | 'scan_state'>): QrRowStatus {
  if (qr.status === null) return 'none';
  if (qr.status === 'revoked') return 'blocked';
  return qr.scan_state === 'private' ? 'private' : 'active';
}

/** Staff took the code down: no downloads, no reissue, only staff issue the next code. */
export function isBlockedByStaff(qr: Pick<QrCodeData, 'status' | 'revoked_reason'>): boolean {
  return qr.status === 'revoked' && qr.revoked_reason === 'moderation';
}
