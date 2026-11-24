<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Database\Factories\BuildScoreFactory;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * M5.9c: a vehicle's Build Score, written only by App\Services\BuildScore\BuildScores (forceFill), read by the score endpoint, the
 * vehicle resources, the share card and M5.9b's rarity tiers.
 *
 * @property string $vehicle_id
 * @property int $total
 * @property int $completeness
 * @property int $documentation
 * @property int $community
 * @property int $journey
 * @property int $stage
 * @property array<string, array{points: int, max: int, have: int}>|null $breakdown
 * @property int|null $previous_total
 * @property string $formula_version
 * @property CarbonInterface|null $changed_at
 * @property CarbonInterface|null $computed_at
 */
#[Table(key: 'vehicle_id', keyType: 'string', incrementing: false)]
class BuildScore extends Model
{
    /** @use HasFactory<BuildScoreFactory> */
    use HasFactory;

    public $timestamps = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'total' => 'integer',
            'completeness' => 'integer',
            'documentation' => 'integer',
            'community' => 'integer',
            'journey' => 'integer',
            'stage' => 'integer',
            'breakdown' => 'array',
            'previous_total' => 'integer',
            'changed_at' => 'datetime',
            'computed_at' => 'datetime',
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
