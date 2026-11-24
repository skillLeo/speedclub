<?php

namespace App\Http\Resources\V1\Stickers;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * STK-06: the Shopify cart link with the design attached, or "Bestellung bald verfügbar" while no store is configured (never a broken
 * link). Open `url` in the in-app browser (web: a new tab).
 *
 * @property array{url: string|null} $resource
 */
class StickerOrderLinkResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $url = $this->resource['url'];

        return [
            'available' => $url !== null,
            /** @var string|null */
            'url' => $url,
            /** @var 'not_configured'|null */
            'reason' => $url === null ? 'not_configured' : null,
            /**
             * "Bestellung bald verfügbar" while not available.
             *
             * @var string|null
             */
            'message' => $url === null ? (string) __('stickers.order_soon') : null,
        ];
    }
}
