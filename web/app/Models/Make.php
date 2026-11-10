<?php

namespace App\Models;

use Database\Factories\MakeFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['name', 'slug', 'country', 'is_popular', 'sort', 'active'])]
class Make extends Model
{
    /** @use HasFactory<MakeFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'is_popular' => 'boolean',
            'merged_into_id' => 'integer',
            'sort' => 'integer',
            'active' => 'boolean',
        ];
    }

    /**
     * The survivor of a merge (M3.3): a merged make stays as the alias of its slug, inactive and unreferenced.
     *
     * @return BelongsTo<self, $this>
     */
    public function mergedInto(): BelongsTo
    {
        return $this->belongsTo(self::class, 'merged_into_id');
    }

    /**
     * @return HasMany<VehicleModel, $this>
     */
    public function models(): HasMany
    {
        return $this->hasMany(VehicleModel::class);
    }

    /**
     * @return HasMany<Vehicle, $this>
     */
    public function vehicles(): HasMany
    {
        return $this->hasMany(Vehicle::class);
    }
}
