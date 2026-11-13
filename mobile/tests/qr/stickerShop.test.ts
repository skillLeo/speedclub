import { stickerShopUrl } from '@/features/qr/stickerShop';

describe('stickerShopUrl', () => {
  it('takes an https address from app-config links only', () => {
    expect(stickerShopUrl({ sticker_shop: ' https://shop.example.de/sticker ' })).toBe('https://shop.example.de/sticker');
    expect(stickerShopUrl({ sticker_shop: 'http://shop.example.de' })).toBeNull();
    expect(stickerShopUrl({ sticker_shop: 'javascript:alert(1)' })).toBeNull();
    expect(stickerShopUrl({ sticker_shop: null })).toBeNull();
    expect(stickerShopUrl({})).toBeNull();
  });
});
