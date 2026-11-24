<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Database\Factories\CrewInviteFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An open invitation of a member into a crew by its founder or an admin (R4-2.3). Accepted (a crew_members row), declined or withdrawn
 * (the row goes). Written by the crew Actions only.
 *
 * @property string $id
 * @property string $crew_id
 * @property string $user_id
 * @property string|null $invited_by
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read Crew $crew
 * @property-read User $user
 * @property-read User|null $inviter
 */
class CrewInvite extends Model
{
    /** @use HasFactory<CrewInviteFactory> */
    use HasFactory, HasUlids;

    /** @var list<string> */
    protected $fillable = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['created_at' => 'immutable_datetime', 'updated_at' => 'immutable_datetime'];
    }

    /**
     * @return BelongsTo<Crew, $this>
     */
    public function crew(): BelongsTo
    {
        return $this->belongsTo(Crew::class);
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
