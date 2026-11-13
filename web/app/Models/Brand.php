<?php

namespace App\Models;

use Database\Factories\BrandFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A part brand (ADM-16; M4.14 BRD-01 adds `about` per language, the official website and the country, from the catalogue data file).
 *
 * @property int $id
 * @property string $name
 * @property string $slug
 * @property string|null $category_hint
 * @property list<string>|null $aliases
 * @property array<string, string>|null $about
 * @property string|null $website
 * @property string|null $country
 * @property int|null $merged_into_id
 */
#[Fillable(['name', 'slug', 'category_hint', 'aliases', 'merged_into_id', 'about', 'website', 'country'])]
class Brand extends Model
{
    /** @use HasFactory<BrandFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['aliases' => 'array', 'about' => 'array'];
    }

    /**
     * @return BelongsTo<self, $this>
     */
    public function mergedInto(): BelongsTo
    {
        return $this->belongsTo(self::class, 'merged_into_id');
    }

    /**
     * @return HasMany<Modification, $this>
     */
    public function modifications(): HasMany
    {
        return $this->hasMany(Modification::class);
    }

    /**
     * @return HasMany<Product, $this>
     */
    public function products(): HasMany
    {
        return $this->hasMany(Product::class);
    }
}
