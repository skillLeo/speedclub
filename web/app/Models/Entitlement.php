<?php

namespace App\Models;

use Database\Factories\EntitlementFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A plan granted to a member by staff (ADM-F2), with reason, start and optional end; revoked, never deleted. Only the Memberships
 * Actions write it.
 *
 * @property string $id
 * @property string $user_id
 * @property int $plan_id
 * @property int|null $granted_by
 * @property string $reason
 * @property Carbon $starts_at
 * @property Carbon|null $ends_at
 * @property Carbon|null $revoked_at
 * @property int|null $revoked_by
 * @property string|null $revoke_reason
 * @property-read User $member
 * @property-read MembershipPlan $plan
 */
class Entitlement extends Model
{
    /** @use HasFactory<EntitlementFactory> */
    use HasFactory, HasUlids;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function member(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id')->withTrashed();
    }

    /**
     * @return BelongsTo<MembershipPlan, $this>
     */
    public function plan(): BelongsTo
    {
        return $this->belongsTo(MembershipPlan::class, 'plan_id');
    }

    /**
     * In force now: not revoked, started, not ended.
     *
     * @param  Builder<self>  $query
     */
    public function scopeCurrent(Builder $query): void
    {
        $query->whereNull('revoked_at')->where('starts_at', '<=', now())
            ->where(fn (Builder $q) => $q->whereNull('ends_at')->orWhere('ends_at', '>', now()));
    }
}
