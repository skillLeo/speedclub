<?php

namespace App\Http\Resources\V1\Shop;

use App\Services\Shop\Views\ShopCategoryCount;
use App\Services\Shop\Views\ShopHeroView;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * SHOP-01 head (m5.5-contract §3.1): the hero (null when none can be shown), the chips "Alle" + three categories with the real number of
 * products each list returns (use it to hide empty chips, never as a visible number; show the row only with ≥ 2 non-empty categories),
 * each chip's status (R4-3.2: available | coming_soon) and the store.
 *
 * @property array{hero: ShopHeroView|null, categories: list<ShopCategoryCount>, store: array{configured: bool, host: string|null, shipping_url: string|null}} $resource
 */
class ShopOverviewResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $hero = $this->resource['hero'];

        return [
            /** @var array{id: string, title: string, subtitle: string|null, image: ShopImageResource, link: array{kind: 'product'|'category', category: string|null, product: array{id: string, slug: string}|null}, is_sample: bool}|null */
            'hero' => $hero === null ? null : [
                'id' => $hero->id,
                'title' => $hero->title,
                'subtitle' => $hero->subtitle,
                'image' => new ShopImageResource($hero->image),
                'link' => [
                    'kind' => $hero->linkKind->value,
                    'category' => $hero->category?->value,
                    'product' => $hero->productId === null ? null : ['id' => $hero->productId, 'slug' => (string) $hero->productSlug],
                ],
                'is_sample' => $hero->isSample,
            ],
            /**
             * R4-3.2: status coming_soon is a visible "Bald verfügbar" chip that does not open (count 0); "all" is always available.
             *
             * @var list<array{key: 'all'|'sticker'|'apparel'|'accessories', label: string, count: int, status: 'available'|'coming_soon'}>
             */
            'categories' => array_map(fn (ShopCategoryCount $row): array => ['key' => $row->key(), 'label' => $row->label(), 'count' => $row->count, 'status' => $row->status->value], $this->resource['categories']),
            /** @var array{configured: bool, host: string|null, shipping_url: string|null} */
            'store' => $this->resource['store'],
        ];
    }
}
