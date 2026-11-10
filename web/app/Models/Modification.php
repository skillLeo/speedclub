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
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Costs are private unless cost_public is set; Resources must honour that for non-owners.
 *
 * @property string $vehicle_id
 * @property Vehicle $vehicle
 * @property ModCategory $category
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
     * @return MorphMany<Media, $this>
     */
    public function media(): MorphMany
    {
        return $this->morphMany(Media::class, 'mediable');
    }
}
