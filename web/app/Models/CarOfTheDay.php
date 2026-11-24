<?php

namespace App\Models;

use App\Enums\Bundesland;
use App\Enums\CarOfTheDaySource;
use Database\Factories\CarOfTheDayFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * M5.9d (m5.9d contract §3, ADR-510): the Car of the Day of one Europe/Berlin day, picked at 17:55 (App\Services\CarOfTheDay\Picker)
 * or chosen by staff, shown on Home from published_at (18:00) to the next day's 18:00. A skipped day keeps its row without a car.
 *
 * @property int $id
 * @property Carbon $day
 * @property string|null $vehicle_id
 * @property string|null $story_line
 * @property Bundesland|null $bundesland
 * @property CarOfTheDaySource $source
 * @property bool $by_vote R4-2.1: the pick came from the members' votes (contract-cotd-voting V5)
 * @property bool $is_sample
 * @property bool $skipped
 * @property string|null $skipped_reason
 * @property int|null $decided_by
 * @property Carbon $picked_at
 * @property Carbon|null $published_at
 * @property Carbon|null $notified_at
 */
class CarOfTheDay extends Model
{
    /** @use HasFactory<CarOfTheDayFactory> */
    use HasFactory;

    protected $table = 'car_of_the_day';

    protected $guarded = ['id'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'day' => 'date',
            'bundesland' => Bundesland::class,
            'source' => CarOfTheDaySource::class,
            'by_vote' => 'boolean',
            'is_sample' => 'boolean',
            'skipped' => 'boolean',
            'picked_at' => 'datetime',
            'published_at' => 'datetime',
            'notified_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }

    /** "2026-11-14". */
    public function dayString(): string
    {
        return $this->day->toDateString();
    }
}
