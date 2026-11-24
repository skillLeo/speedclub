import { StickerRedirect } from '@/features/qr/redirects';

/** M5.4: QR-03 moved to STK-03 `/stickers/[vehicleId]/placement`. */
export default function Route() {
  return <StickerRedirect to="/stickers/[vehicleId]/placement" />;
}
