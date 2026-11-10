<?php

namespace App\Models;

use App\Enums\SearchSort;
use Database\Factories\DiscoverCollectionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Spatie\Translatable\HasTranslations;

/**
 * A "Kollektion" of DISC-01 (M2.3): a saved DISC-02 search with a title, edited by the admin in Phase 3 (ADM-29). Not named Collection,
 * which Laravel already uses.
 *
 * @property string $key
 * @property array<string, mixed> $filters
 * @property SearchSort|null $sort
 */
#[Table('collections')]
#[Fillable(['key', 'title', 'subtitle', 'cover_vehicle_id', 'filters', 'sort', 'position', 'active'])]
class DiscoverCollection extends Model
{
    /** @use HasFactory<DiscoverCollectionFactory> */
    use HasFactory, HasTranslations;

    /**
     * @var array<int, string>
     */
    public array $translatable = ['title', 'subtitle'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'filters' => 'array',
            'sort' => SearchSort::class,
            'position' => 'integer',
            'active' => 'boolean',
        ];
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function coverVehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class, 'cover_vehicle_id');
    }
}
