<?php

namespace App\Models;

use App\Enums\MaintenanceType;
use Carbon\CarbonImmutable;
use Database\Factories\MaintenanceLogFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphMany;

/**
 * One entry of a vehicle's service log (MNT-01 "Verlauf", 09 §8.8): date, mileage, workshop (free text; the business link of M4.14 in
 * business_id), the private cost, notes and photos (private disk, signed URLs). Owner-only, always.
 *
 * @property string $id
 * @property string $vehicle_id
 * @property string|null $item_id
 * @property MaintenanceType $type
 * @property string|null $title
 * @property CarbonImmutable $done_at
 * @property int|null $mileage_km
 * @property string|null $business_id
 * @property string|null $workshop
 * @property int|null $cost_cents
 * @property string $currency
 * @property string|null $notes
 * @property int $version
 * @property-read Vehicle $vehicle
 * @property-read MaintenanceItem|null $item
 */
class MaintenanceLog extends Model
{
    /** @use HasFactory<MaintenanceLogFactory> */
    use HasFactory, HasUlids;

    /** At most this many photos (receipts, the stamp in the booklet) per entry. */
    public const MAX_PHOTOS = 6;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'type' => MaintenanceType::class,
            'done_at' => 'immutable_date',
            'mileage_km' => 'integer',
            'cost_cents' => 'integer',
            'version' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }

    /**
     * @return BelongsTo<MaintenanceItem, $this>
     */
    public function item(): BelongsTo
    {
        return $this->belongsTo(MaintenanceItem::class, 'item_id');
    }

    /**
     * @return MorphMany<Media, $this>
     */
    public function media(): MorphMany
    {
        return $this->morphMany(Media::class, 'mediable');
    }
}
