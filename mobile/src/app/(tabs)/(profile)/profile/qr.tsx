import { StickerRedirect } from '@/features/qr/redirects';

/** M5.4: QR-01 "Meine QR-Codes" became STK-01 "Meine Sticker" at `/stickers`. */
export default function Route() {
  return <StickerRedirect to="/stickers" />;
}
