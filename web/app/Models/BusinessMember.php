<?php

namespace App\Models;

use App\Enums\BusinessRole;
use Database\Factories\BusinessMemberFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A member of a business team (09 §8.10): the owner and staff the owner added. One business per member.
 *
 * @property string $id
 * @property string $business_id
 * @property string $user_id
 * @property BusinessRole $role
 * @property-read Business $business
 * @property-read User $user
 */
class BusinessMember extends Model
{
    /** @use HasFactory<BusinessMemberFactory> */
    use HasFactory, HasUlids;

    /** @var list<string> */
    protected $fillable = ['business_id', 'user_id', 'role'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['role' => BusinessRole::class];
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
}
