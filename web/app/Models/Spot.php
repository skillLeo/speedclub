<?php

namespace App\Models;

use App\Enums\Bundesland;
use App\Enums\SpotSource;
use Database\Factories\SpotFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Support\Carbon;

/**
 * M5.9b STREET DEX (10 §16.2, contract §1–§2): one in-app scan of a car's sticker by another member. City and Bundesland only, never a
 * coordinate. counted is false for accounts younger than 24 h; is_night for 22:00–06:00 Europe/Berlin (counted, but its city is never
 * shown for a single car); is_first_three for the car's first three unique spotters (the permanent "First Spotter" foil). Written by
 * App\Actions\Dex\RecordSpot only; staff removal is a soft delete with an audited reason.
 *
 * @property string $id
 * @property string $vehicle_id
 * @property string $spotter_id
 * @property int|null $city_id
 * @property Bundesland|null $bundesland
 * @property bool $is_first_three
 * @property bool $counted
 * @property bool $is_night
 * @property SpotSource $source
 * @property Carbon|null $created_at
 * @property Vehicle $vehicle
 * @property User|null $spotter
 * @property DeCity|null $city
 */
class Spot extends Model
{
    /** @use HasFactory<SpotFactory> */
    use HasFactory, HasUlids, SoftDeletes;

    public const UPDATED_AT = null;

    /** Nothing is mass assignable: RecordSpot sets every column through forceFill. */
    protected $guarded = ['*'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'bundesland' => Bundesland::class,
            'is_first_three' => 'boolean',
            'counted' => 'boolean',
            'is_night' => 'boolean',
            'source' => SpotSource::class,
            'city_id' => 'integer',
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
     * @return BelongsTo<User, $this>
     */
    public function spotter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'spotter_id');
    }

    /**
     * @return BelongsTo<DeCity, $this>
     */
    public function city(): BelongsTo
    {
        return $this->belongsTo(DeCity::class, 'city_id');
    }
}
