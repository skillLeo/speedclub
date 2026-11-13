<?php

namespace App\Models;

use Database\Factories\VehicleFollowFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Following a build without following its owner (09 §8.6). The count is the owner's alone; nobody else learns it.
 *
 * @property int $id
 * @property string $user_id
 * @property string $vehicle_id
 */
#[Fillable(['user_id', 'vehicle_id'])]
class VehicleFollow extends Model
{
    /** @use HasFactory<VehicleFollowFactory> */
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
