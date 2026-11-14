<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Database\Factories\BusinessInviteFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * SEC-414-01 (09 §8.10 "invited staff"): an open invitation of a member to a business team. The invited member accepts (the row becomes
 * a business_members row as staff) or declines (the row goes); the owner withdraws it (the row goes). An open invite is no role: it
 * never edits the profile, decides a tag or confirms a portfolio tag, and never blocks the member's own application. Written only by
 * ChangeBusinessTeam (forceFill).
 *
 * @property string $id
 * @property string $business_id
 * @property string $user_id
 * @property string|null $invited_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read Business $business
 * @property-read User $user
 * @property-read User|null $inviter
 */
class BusinessInvite extends Model
{
    /** @use HasFactory<BusinessInviteFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['created_at' => 'immutable_datetime', 'updated_at' => 'immutable_datetime'];
    }

    /**
     * @return BelongsTo<Business, $this>
     */
    public function business(): BelongsTo
    {
        return $this->belongsTo(Business::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function inviter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'invited_by');
    }
}
