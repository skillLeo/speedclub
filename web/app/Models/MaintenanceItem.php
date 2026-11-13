<?php

namespace App\Models;

use App\Enums\MaintenanceType;
use Carbon\CarbonImmutable;
use Database\Factories\MaintenanceItemFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One maintenance item of a vehicle (09 §8.8, MNT-01/02): owner-only. Only App\Actions\Maintenance write it (forceFill); the due date
 * comes from App\Services\Maintenance\MaintenanceSchedule. The HU/AU item mirrors vehicles.hu_au_due.
 *
 * @property string $id
 * @property string $vehicle_id
 * @property MaintenanceType $type
 * @property string|null $title
 * @property int|null $interval_months
 * @property int|null $interval_km
 * @property CarbonImmutable|null $last_done_at
 * @property int|null $last_done_km
 * @property CarbonImmutable|null $next_due_at
 * @property int|null $next_due_km
 * @property bool $due_pinned
 * @property list<int>|null $lead_days
 * @property bool $enabled
 * @property string|null $notes
 * @property int $version
 * @property-read Vehicle $vehicle
 */
class MaintenanceItem extends Model
{
    /** @use HasFactory<MaintenanceItemFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'type' => MaintenanceType::class,
            'interval_months' => 'integer',
            'interval_km' => 'integer',
            'last_done_at' => 'immutable_date',
            'last_done_km' => 'integer',
            'next_due_at' => 'immutable_date',
            'next_due_km' => 'integer',
            'due_pinned' => 'boolean',
            'lead_days' => 'array',
            'enabled' => 'boolean',
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
     * @return HasMany<MaintenanceLog, $this>
     */
    public function logs(): HasMany
    {
        return $this->hasMany(MaintenanceLog::class, 'item_id');
    }

    /**
     * @return HasMany<MaintenanceReminder, $this>
     */
    public function reminders(): HasMany
    {
        return $this->hasMany(MaintenanceReminder::class, 'item_id');
    }

    /**
     * The lead times in days, longest first, without repeats; the type's default when none is stored.
     *
     * @return list<int>
     */
    public function leadDays(): array
    {
        $stored = is_array($this->lead_days) ? array_values(array_filter($this->lead_days, is_int(...))) : [];
        $days = array_values(array_unique($stored === [] ? $this->type->defaultLeadDays() : $stored));
        rsort($days);

        return $days;
    }
}
