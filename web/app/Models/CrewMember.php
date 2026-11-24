<?php

namespace App\Models;

use App\Enums\CrewRole;
use Carbon\CarbonImmutable;
use Database\Factories\CrewMemberFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A member of a crew (R4-2.3) with their role; role_rank (0 founder, 1 admin, 2 member) orders the member list. Written by the crew
 * Actions only (forceFill).
 *
 * @property string $id
 * @property string $crew_id
 * @property string $user_id
 * @property CrewRole $role
 * @property int $role_rank
 * @property CarbonImmutable $joined_at
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read Crew $crew
 * @property-read User $user
 */
class CrewMember extends Model
{
    /** @use HasFactory<CrewMemberFactory> */
    use HasFactory, HasUlids;

    /** @var list<string> */
    protected $fillable = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'role' => CrewRole::class,
            'role_rank' => 'integer',
            'joined_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Crew, $this>
     */
    public function crew(): BelongsTo
    {
        return $this->belongsTo(Crew::class)->withTrashed();
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
