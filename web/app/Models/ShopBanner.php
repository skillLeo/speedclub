<?php

namespace App\Models;

use App\Enums\ShopBannerLink;
use App\Enums\ShopCategory;
use Database\Factories\ShopBannerFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * M5.5 ADM-67: a SHOP-01 hero (m5.5-contract §1). At most one is active; its photo is not cropped (the app crops with the focal point).
 *
 * @property string $id
 * @property string $title
 * @property string|null $subtitle
 * @property ShopBannerLink $link_kind
 * @property string|null $shop_product_id
 * @property ShopCategory|null $category
 * @property string|null $alt
 * @property int $width
 * @property int $height
 * @property int $original_width
 * @property int $original_height
 * @property float $focal_x
 * @property float $focal_y
 * @property string $blurhash
 * @property string|null $thumbhash
 * @property string $original_path
 * @property array<int|string, string> $variants
 * @property string $sha256
 * @property int $bytes
 * @property bool $active
 * @property bool $is_sample
 * @property int|null $created_by
 * @property int|null $updated_by
 */
#[Fillable(['title', 'subtitle', 'link_kind', 'shop_product_id', 'category', 'alt', 'focal_x', 'focal_y'])]
class ShopBanner extends Model
{
    /** @use HasFactory<ShopBannerFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'link_kind' => ShopBannerLink::class,
            'category' => ShopCategory::class,
            'width' => 'integer',
            'height' => 'integer',
            'original_width' => 'integer',
            'original_height' => 'integer',
            'focal_x' => 'float',
            'focal_y' => 'float',
            'variants' => 'array',
            'bytes' => 'integer',
            'active' => 'boolean',
            'is_sample' => 'boolean',
        ];
    }

    /**
     * @return BelongsTo<ShopProduct, $this>
     */
    public function product(): BelongsTo
    {
        return $this->belongsTo(ShopProduct::class, 'shop_product_id')->withTrashed();
    }
}
