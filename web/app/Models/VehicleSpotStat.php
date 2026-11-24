<?php

namespace App\Models;

use Database\Factories\VehicleSpotStatFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * M5.9b (contract §1, §4): a car's spot numbers, kept by App\Services\Dex\SpotStats (on each counted spot; nightly repair in part 2).
 * Counted spots only; cities_count counts the cities of day spots. Owner-only data: never on a public read.
 *
 * @property string $vehicle_id
 * @property int $total
 * @property int $unique_spotters
 * @property int $cities_count
 * @property Carbon|null $last_spot_at
 * @property int|null $street_famous_tier
 */
class VehicleSpotStat extends Model
{
    /** @use HasFactory<VehicleSpotStatFactory> */
    use HasFactory;

    public const CREATED_AT = null;

    protected $primaryKey = 'vehicle_id';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $guarded = ['*'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'total' => 'integer',
            'unique_spotters' => 'integer',
            'cities_count' => 'integer',
            'last_spot_at' => 'datetime',
            'street_famous_tier' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }
}
