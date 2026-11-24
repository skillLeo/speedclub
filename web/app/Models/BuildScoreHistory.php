<?php

namespace App\Models;

use Carbon\CarbonInterface;
use Database\Factories\BuildScoreHistoryFactory;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * M5.9c: the total of a vehicle's Build Score at the end of each Berlin day on which it changed (Wrapped, INS-01 progress).
 *
 * @property int $id
 * @property string $vehicle_id
 * @property CarbonInterface $day
 * @property int $total
 */
#[Table(name: 'build_score_history')]
class BuildScoreHistory extends Model
{
    /** @use HasFactory<BuildScoreHistoryFactory> */
    use HasFactory;

    public $timestamps = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['day' => 'date', 'total' => 'integer'];
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }
}
