<?php

namespace App\Models;

use Database\Factories\SpotAlertFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * M5.9b (contract §1, §4): grouping state of the 3-hourly owner alert ("Dein EK9 wurde heute 4-mal in Düsseldorf gespottet."). City ids
 * only of day spots. Written by the alert job (M5.9b part 2).
 *
 * @property int $id
 * @property string $vehicle_id
 * @property Carbon|null $window_start
 * @property int $count
 * @property list<int>|null $city_ids
 * @property Carbon|null $sent_at
 */
class SpotAlert extends Model
{
    /** @use HasFactory<SpotAlertFactory> */
    use HasFactory;

    protected $guarded = ['*'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'window_start' => 'datetime',
            'count' => 'integer',
            'city_ids' => 'array',
            'sent_at' => 'datetime',
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
