<?php

namespace App\Models;

use App\Enums\ShopCategory;
use App\Enums\ShopPurchaseMode;
use App\Enums\ShopVariantKind;
use Database\Factories\ShopProductFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;

/**
 * M5.5 ADM-66 catalogue row (m5.5-contract §1): a product of the local ShopCatalogue driver. Gross price in cents incl. MwSt.; the buy
 * link is built by App\Services\Shop\ShopLinks, never stored ready-made except the validated product URL.
 *
 * @property string $id
 * @property string $slug
 * @property string $title
 * @property string|null $description
 * @property ShopCategory $category
 * @property int $price_cents
 * @property string $currency
 * @property ShopVariantKind $variant_kind
 * @property array<int, mixed>|null $variants stored chips; read them through variantList()
 * @property ShopPurchaseMode $purchase_mode
 * @property string|null $shopify_url
 * @property int $sort
 * @property bool $visible
 * @property bool $is_sample
 * @property int|null $created_by
 * @property int|null $updated_by
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 * @property Carbon|null $deleted_at
 */
#[Fillable(['slug', 'title', 'description', 'category', 'price_cents', 'currency', 'variant_kind', 'variants', 'purchase_mode', 'shopify_url', 'sort', 'visible'])]
class ShopProduct extends Model
{
    /** @use HasFactory<ShopProductFactory> */
    use HasFactory, HasUlids, SoftDeletes;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'category' => ShopCategory::class,
            'variant_kind' => ShopVariantKind::class,
            'purchase_mode' => ShopPurchaseMode::class,
            'variants' => 'array',
            'price_cents' => 'integer',
            'sort' => 'integer',
            'visible' => 'boolean',
            'is_sample' => 'boolean',
        ];
    }

    /**
     * @return HasMany<ShopProductImage, $this>
     */
    public function images(): HasMany
    {
        return $this->hasMany(ShopProductImage::class)->orderBy('sort')->orderBy('id');
    }

    /**
     * @return list<array{id: string, label: string, shopify_variant_id: string|null}>
     */
    public function variantList(): array
    {
        $list = [];

        foreach ($this->variants ?? [] as $variant) {
            if (is_array($variant) && isset($variant['id'], $variant['label'])) {
                $id = $variant['shopify_variant_id'] ?? null;
                $list[] = ['id' => (string) $variant['id'], 'label' => (string) $variant['label'], 'shopify_variant_id' => is_scalar($id) && (string) $id !== '' ? (string) $id : null];
            }
        }

        return $list;
    }

    /**
     * Visible, not deleted, with at least one photo: what a member list may show (samples are constrained by SampleContent on top).
     *
     * @param  Builder<ShopProduct>  $query
     * @return Builder<ShopProduct>
     */
    public function scopeListed(Builder $query): Builder
    {
        return $query->where('shop_products.visible', true)->whereHas('images');
    }
}
