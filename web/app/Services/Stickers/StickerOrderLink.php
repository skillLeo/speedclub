<?php

namespace App\Services\Stickers;

use App\Enums\StickerSize;
use App\Models\StickerDesign;
use App\Models\Vehicle;
use App\Services\Shop\ShopDomain;

/**
 * "Sticker bestellen" (STK-06, m5.4-contract §7): a Shopify cart permalink with the design attached as cart attributes, as shopify.dev
 * "Create cart permalinks" documents it (checked 2026-11-15): /cart/{variant_id}:{quantity}?attributes[key]=value, `storefront=true`
 * for the online-store cart instead of checkout. The newer cart-and-checkout permalinks cannot carry attributes yet. Null while the
 * store or the variant of this size is not configured (OA-44): the app then shows "Bestellung bald verfügbar". The store host is the shop's
 * (App\Services\Shop\ShopDomain, M5.5), so a shop product and this link always go to the same store.
 */
final class StickerOrderLink
{
    public function __construct(private readonly ShopDomain $domain = new ShopDomain) {}

    public function url(StickerDesign $design, Vehicle $vehicle): ?string
    {
        $domain = $this->domain();
        $variant = $this->variant($design->stickerOptions()->size);

        if ($domain === null || $variant === null) {
            return null;
        }

        return 'https://'.$domain.'/cart/'.$variant.':1?'
            .'attributes[sticker_design]='.rawurlencode($design->reference)
            .'&attributes[vehicle]='.rawurlencode($vehicle->canonicalSlug())
            .'&storefront=true';
    }

    public function configured(StickerSize $size): bool
    {
        return $this->domain() !== null && $this->variant($size) !== null;
    }

    private function domain(): ?string
    {
        return $this->domain->host();
    }

    private function variant(StickerSize $size): ?string
    {
        foreach ([config('speedclub.stickers.shop.variants.'.$size->value), config('speedclub.stickers.shop.variant')] as $value) {
            if ((is_string($value) || is_int($value)) && preg_match('/\A\d{1,20}\z/', (string) $value) === 1) {
                return (string) $value;
            }
        }

        return null;
    }
}
