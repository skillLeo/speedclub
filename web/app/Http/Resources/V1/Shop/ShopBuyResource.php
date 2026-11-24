<?php

namespace App\Http\Resources\V1\Shop;

use App\Services\Shop\Views\ShopBuyView;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * "Im Shop kaufen" (m5.5-contract §3.3), built on the server only: `external` opens `url` (https, on the store) in the in-app browser
 * (web: a new tab, noopener), `designer` navigates to `path` (STK-01), unavailable shows `message` ("Bald im Shop erhältlich"), never a
 * dead button. Payment always happens on the store, never in the app (ADR-502).
 *
 * @property ShopBuyView $resource
 */
class ShopBuyResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $buy = $this->resource;

        return [
            'available' => $buy->available,
            /** @var 'external'|'designer'|null */
            'kind' => $buy->kind,
            /** @var string|null */
            'url' => $buy->url,
            /** @var '/stickers'|null */
            'path' => $buy->path,
            /** @var 'not_configured'|null */
            'reason' => $buy->available ? null : 'not_configured',
            /** @var string|null */
            'message' => $buy->available ? null : (string) __('shop.buy_soon'),
        ];
    }
}
