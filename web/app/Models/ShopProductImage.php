<?php

namespace App\Models;

use Database\Factories\ShopProductImageFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * M5.5: one 4:5 photo of a shop product (m5.5-contract §1), re-encoded by App\Services\Shop\ShopImages. The private clean original is the
 * uncropped re-encode, so a new focal point re-derives the crop.
 *
 * @property string $id
 * @property string $shop_product_id
 * @property int $sort
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
 * @property int|null $uploaded_by
 */
#[Fillable(['sort', 'alt', 'focal_x', 'focal_y'])]
class ShopProductImage extends Model
{
    /** @use HasFactory<ShopProductImageFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'sort' => 'integer',
            'width' => 'integer',
            'height' => 'integer',
            'original_width' => 'integer',
            'original_height' => 'integer',
            'focal_x' => 'float',
            'focal_y' => 'float',
            'variants' => 'array',
            'bytes' => 'integer',
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
