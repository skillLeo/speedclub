<?php

namespace App\Models;

use Database\Factories\CarOfTheDayCandidateFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * R4-2.1 (contract-cotd-voting V2): a candidate of a day's round, frozen when the round opens (the Picker's top 3, never a sample).
 * position is the Picker's order and breaks a tie.
 *
 * @property int $id
 * @property Carbon $day
 * @property string $vehicle_id
 * @property int $position
 * @property Carbon|null $created_at
 */
class CarOfTheDayCandidate extends Model
{
    /** @use HasFactory<CarOfTheDayCandidateFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    protected $table = 'car_of_the_day_candidates';

    protected $guarded = ['id'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['day' => 'date', 'position' => 'integer'];
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }
}
