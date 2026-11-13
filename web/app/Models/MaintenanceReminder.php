<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A reminder stage the server handled (09 §8.8): reminder_key is the deterministic id the app gives its local backup notification, so
 * a stage is told once whichever side gets there first. sent_at null: passed over (a shorter lead time was already due), never sent.
 *
 * @property int $id
 * @property string $item_id
 * @property string $user_id
 * @property string $reminder_key
 * @property CarbonImmutable|null $due_on
 * @property int|null $due_km
 * @property int|null $lead_days
 * @property CarbonImmutable|null $sent_at
 */
class MaintenanceReminder extends Model
{
    public const UPDATED_AT = null;

    /** @var list<string> */
    protected $guarded = ['id'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'due_on' => 'immutable_date',
            'due_km' => 'integer',
            'lead_days' => 'integer',
            'sent_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<MaintenanceItem, $this>
     */
    public function item(): BelongsTo
    {
        return $this->belongsTo(MaintenanceItem::class, 'item_id');
    }
}
