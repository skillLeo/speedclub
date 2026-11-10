<?php

namespace App\Models;

use Database\Factories\StaffInvitationFactory;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * An invite link of ADM-39 (App\Services\Team\StaffInvites): the SHA-256 of a random 256-bit token, valid 72 hours and once. A resend
 * marks the previous link replaced. Only StaffInvites and the Team Actions write it.
 *
 * @property string $id
 * @property int $staff_id
 * @property int|null $invited_by
 * @property string $token_hash
 * @property Carbon $expires_at
 * @property Carbon|null $used_at
 * @property Carbon|null $replaced_at
 * @property-read Staff $staff
 */
#[Hidden(['token_hash'])]
class StaffInvitation extends Model
{
    /** @use HasFactory<StaffInvitationFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'used_at' => 'datetime',
            'replaced_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Staff, $this>
     */
    public function staff(): BelongsTo
    {
        return $this->belongsTo(Staff::class);
    }

    public function isUsable(): bool
    {
        return $this->used_at === null && $this->replaced_at === null && $this->expires_at->isFuture();
    }
}
