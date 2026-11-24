<?php

namespace App\Models;

use App\Enums\StaffAlertKind;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * One security mail to one staff member (StaffAlerts, SF-5/SEC-P5-07 of M5.1): written when it is queued, `sent_at` once
 * DeliverStaffAlert sent it, `failed_at` when the retries ran out. `dedupe_key` names the occasion, so it is mailed once.
 *
 * @property string $id
 * @property StaffAlertKind $kind
 * @property string $dedupe_key
 * @property int $staff_id
 * @property array<string, string> $payload
 * @property int $attempts
 * @property Carbon|null $sent_at
 * @property Carbon|null $failed_at
 * @property-read Staff|null $staff
 */
class StaffAlert extends Model
{
    use HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'kind' => StaffAlertKind::class,
            'staff_id' => 'integer',
            'payload' => 'array',
            'attempts' => 'integer',
            'sent_at' => 'datetime',
            'failed_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Staff, $this>
     */
    public function staff(): BelongsTo
    {
        return $this->belongsTo(Staff::class);
    }
}
