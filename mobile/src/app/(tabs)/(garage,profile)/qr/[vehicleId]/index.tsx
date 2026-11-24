import { StickerRedirect } from '@/features/qr/redirects';

/** M5.4 (10 §2.1, ADR-504): QR-02 moved to STK-02 `/stickers/[vehicleId]`; old links, pushes and notifications land there. */
export default function Route() {
  return <StickerRedirect to="/stickers/[vehicleId]" />;
}
