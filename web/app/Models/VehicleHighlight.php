<?php

namespace App\Models;

use App\Enums\HighlightItemType;
use Database\Factories\VehicleHighlightFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An update or photo the owner pinned to the vehicle's Highlights rail (09 §8.5): permanent, at most 8, in the owner's order.
 *
 * @property int $id
 * @property string $vehicle_id
 * @property HighlightItemType $item_type
 * @property string $item_id
 * @property int $position
 */
#[Fillable(['vehicle_id', 'item_type', 'item_id', 'position'])]
class VehicleHighlight extends Model
{
    /** @use HasFactory<VehicleHighlightFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['item_type' => HighlightItemType::class, 'position' => 'integer'];
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }
}
