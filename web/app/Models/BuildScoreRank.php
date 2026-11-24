<?php

namespace App\Models;

use App\Enums\BuildScoreRankScope;
use Carbon\CarbonInterface;
use Database\Factories\BuildScoreRankFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * M5.9c: a nightly rank of a vehicle's Build Score in its generation or its owner's Bundesland (App\Services\BuildScore\BuildScoreNightly).
 * Only stored for groups of at least build_score.ranks.min_group cars.
 *
 * @property int $id
 * @property string $vehicle_id
 * @property BuildScoreRankScope $scope
 * @property string $scope_key generation id or Bundesland code
 * @property int $rank
 * @property int $group_size
 * @property CarbonInterface|null $computed_at
 */
class BuildScoreRank extends Model
{
    /** @use HasFactory<BuildScoreRankFactory> */
    use HasFactory;

    public $timestamps = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'scope' => BuildScoreRankScope::class,
            'rank' => 'integer',
            'group_size' => 'integer',
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
