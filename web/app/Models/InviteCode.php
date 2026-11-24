<?php

namespace App\Models;

use Database\Factories\InviteCodeFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * M5.9d (m5.9d contract §5): an invite code (8 characters Crockford) of a member; redeemed once, when the invitee's account activates
 * (App\Services\Members\MemberActivation). Codes of a deleted member die with the account.
 *
 * @property string $code
 * @property string $inviter_id
 * @property string|null $accepted_by
 * @property Carbon|null $accepted_at
 * @property Carbon|null $created_at
 */
class InviteCode extends Model
{
    /** @use HasFactory<InviteCodeFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    protected $primaryKey = 'code';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $guarded = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'accepted_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function inviter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'inviter_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function invitee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'accepted_by');
    }
}
