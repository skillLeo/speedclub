<?php

namespace App\Models;

use Database\Factories\SaveFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Private bookmark of a build; owners only ever see aggregated counts.
 *
 * @property string $user_id
 * @property string $vehicle_id
 */
#[Fillable(['user_id', 'vehicle_id'])]
class Save extends Model
{
    /** @use HasFactory<SaveFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

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
