<?php

namespace App\Models;

use Database\Factories\CarOfTheDayVoteFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * R4-2.1 (contract-cotd-voting §1): one member's vote in the round of a Europe/Berlin day, changeable until the round closes. Counts are
 * staff data only (CarOfTheDayVotes::staffTally); no member response carries one.
 *
 * @property string $id
 * @property Carbon $day
 * @property string $user_id
 * @property string $vehicle_id
 * @property Carbon $created_at
 * @property Carbon $updated_at
 */
class CarOfTheDayVote extends Model
{
    /** @use HasFactory<CarOfTheDayVoteFactory> */
    use HasFactory, HasUlids;

    protected $table = 'car_of_the_day_votes';

    protected $guarded = ['id'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['day' => 'date'];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }
}
