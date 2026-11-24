<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Database\Factories\CrewRequestFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An open request of a member to join a crew in `request` mode (R4-2.3). Approved (it becomes a crew_members row), declined or withdrawn
 * (the row goes). Written by the crew Actions only.
 *
 * @property string $id
 * @property string $crew_id
 * @property string $user_id
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property-read Crew $crew
 * @property-read User $user
 */
class CrewRequest extends Model
{
    /** @use HasFactory<CrewRequestFactory> */
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
}
