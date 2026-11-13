<?php

namespace App\Models;

use App\Enums\LegalStatus;
use App\Enums\ModStatus;
use Database\Factories\ModificationFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Costs are private to the owner, always (09 §11, M4.9 ruling); cost_public is a dead column kept false.
 *
 * @property string $vehicle_id
 * @property Vehicle $vehicle
 * @property ModCategory $category
 * @property string|null $product_id
 * @property string|null $installed_by_business_id
 */
#[Fillable([
    'category_id', 'title', 'brand_id', 'brand_text', 'part_name', 'part_number', 'status', 'installed_on',
    'cost_cents', 'cost_public', 'legal_status', 'notes', 'fields', 'sort',
])]
class Modification extends Model
{
    /** @use HasFactory<ModificationFactory> */
    use HasFactory, HasUlids, SoftDeletes;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => ModStatus::class,
            'installed_on' => 'date',
            'cost_cents' => 'integer',
            'cost_public' => 'boolean',
            'legal_status' => LegalStatus::class,
            'fields' => 'array',
            'sort' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class)->withTrashed();
    }

    /**
     * @return BelongsTo<ModCategory, $this>
     */
    public function category(): BelongsTo
    {
        return $this->belongsTo(ModCategory::class, 'category_id');
    }

    /**
     * @return BelongsTo<Brand, $this>
     */
    public function brand(): BelongsTo
    {
        return $this->belongsTo(Brand::class);
    }

    /**
     * M4.14 (09 §8.9): the catalogue product, when the member linked one (free text stays possible).
     *
     * @return BelongsTo<Product, $this>
     */
    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    /**
     * M4.14 (09 §8.10): "Eingebaut von", set only once both sides confirmed the tag.
     *
     * @return BelongsTo<Business, $this>
     */
    public function installedBy(): BelongsTo
    {
        return $this->belongsTo(Business::class, 'installed_by_business_id');
    }

    /**
     * @return HasOne<ModBusinessTag, $this>
     */
    public function businessTag(): HasOne
    {
        return $this->hasOne(ModBusinessTag::class, 'mod_id');
    }

    /**
     * @return MorphMany<Media, $this>
     */
    public function media(): MorphMany
    {
        return $this->morphMany(Media::class, 'mediable');
    }
}
