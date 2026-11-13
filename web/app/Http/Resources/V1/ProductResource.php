<?php

namespace App\Http\Resources\V1;

use App\Services\AppConfig\FeatureFlags;
use Illuminate\Http\Request;

/**
 * BRD-02 Produkt (09 §7.11): the row plus the key attributes table, the official link and, only while `affiliate_links` is on, the
 * affiliate link with its "Anzeige" label and rel="sponsored" (UWG transparency). The builds using it follow from
 * `products/{id}/builds`.
 */
class ProductResource extends ProductRowResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $product = $this->resource;
        $affiliate = app(FeatureFlags::class)->enabled('affiliate_links') ? $product->affiliate_url : null;
        $rows = [];

        foreach ($product->attributeTable(app()->getLocale()) as $label => $value) {
            $rows[] = ['label' => $label, 'value' => $value];
        }

        return [
            ...parent::toArray($request),
            /**
             * Key attributes from the catalogue, in the reader's language (German where the catalogue has no English).
             *
             * @var list<array{label: string, value: string}>
             */
            'attributes' => $rows,
            /** The maker's page. @var string|null */
            'url' => $product->url,
            /**
             * Only while affiliate_links is on and the product has one: show `label` next to the link and set `rel`.
             *
             * @var array{url: string, label: string, rel: string}|null
             */
            'affiliate' => is_string($affiliate) ? ['url' => $affiliate, 'label' => (string) __('parts.affiliate_label'), 'rel' => 'sponsored noopener'] : null,
            /** "/brands/kw" */
            'brand_path' => '/brands/'.$product->brand->slug,
        ];
    }
}
