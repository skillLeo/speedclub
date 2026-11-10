<?php

namespace App\Models;

use App\Enums\BrandAssetKind;
use Database\Factories\BrandAssetFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A logo, hero, splash or OG image uploaded in ADM-28 (App\Services\Brand\BrandAssets). Config versions name it by id; it is never
 * deleted, so a rollback always finds what an older version names.
 *
 * @property string $id
 * @property BrandAssetKind $kind
 * @property string $original_path
 * @property array<int, string> $variants WebP paths on the public disk by width
 * @property string|null $png_path
 * @property string|null $og_path
 * @property int $width
 * @property int $height
 * @property string|null $blurhash
 * @property int $bytes
 * @property string $sha256
 * @property int|null $uploaded_by
 */
#[Fillable(['kind', 'original_path', 'variants', 'png_path', 'og_path', 'width', 'height', 'blurhash', 'bytes', 'sha256', 'uploaded_by'])]
#[Hidden(['original_path'])]
class BrandAsset extends Model
{
    /** @use HasFactory<BrandAssetFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'kind' => BrandAssetKind::class,
            'variants' => 'array',
            'width' => 'integer',
            'height' => 'integer',
            'bytes' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Staff, $this>
     */
    public function uploader(): BelongsTo
    {
        return $this->belongsTo(Staff::class, 'uploaded_by');
    }
}
