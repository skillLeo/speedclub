/**
 * M5.4 (10 §2.1, ADR-504, m5.4-contract §10): the QR routes became sticker routes. The old app addresses stay as redirects, so links,
 * pushes and notifications of older builds keep working: `/profile/qr` → `/stickers`, `/qr/{id}` → `/stickers/{id}`,
 * `/qr/{id}/placement|preview` → `/stickers/{id}/placement|preview`, the query string kept. A replace, so back never returns to the old
 * address. The member web answers the same with a 301 on the server (SpaController::movedPath); `/c/{code}` never changes.
 */
import { Redirect, useLocalSearchParams } from 'expo-router';

export type StickerTarget =
  | '/stickers'
  | '/stickers/[vehicleId]'
  | '/stickers/[vehicleId]/placement'
  | '/stickers/[vehicleId]/preview';

export function StickerRedirect({ to }: { to: StickerTarget }) {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  return <Redirect href={{ pathname: to, params }} />;
}
