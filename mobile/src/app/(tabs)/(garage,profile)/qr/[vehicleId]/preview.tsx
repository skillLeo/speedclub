import { StickerRedirect } from '@/features/qr/redirects';

/** M5.4: QR-04 moved to `/stickers/[vehicleId]/preview`. */
export default function Route() {
  return <StickerRedirect to="/stickers/[vehicleId]/preview" />;
}
