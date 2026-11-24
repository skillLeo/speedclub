<?php

namespace App\Models;

use App\Enums\Bundesland;
use App\Enums\CrewEndReason;
use App\Enums\CrewJoinMode;
use App\Enums\CrewRole;
use App\Enums\CrewStatus;
use Carbon\CarbonImmutable;
use Database\Factories\CrewFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A crew (R4-2.3, contract-crews.md §1): a group of members with one founder, admins and members. Found by its slug (an old slug after a
 * rename too). Name, slug, status and counters are written by the Actions only (forceFill); nothing is mass assignable. members_count is
 * a fact the card shows and never an order.
 *
 * @property string $id
 * @property string $name
 * @property string|null $name_key
 * @property string $slug
 * @property string|null $previous_slug
 * @property string|null $description
 * @property string|null $logo_media_id
 * @property string|null $cover_media_id
 * @property Bundesland|null $bundesland
 * @property CrewJoinMode $join_mode
 * @property CrewStatus $status
 * @property string|null $status_before_removal
 * @property CrewEndReason|null $ended_reason R4DQ-55: set when the system ended the crew (no member left)
 * @property CarbonImmutable|null $hidden_at
 * @property CarbonImmutable|null $removed_at
 * @property int $members_count
 * @property bool $is_sample
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property CarbonImmutable|null $deleted_at
 * @property-read Media|null $logo
 * @property-read Media|null $cover
 * @property-read CrewMember|null $founderMembership
 */
class Crew extends Model
{
    /** @use HasFactory<CrewFactory> */
    use HasFactory, HasUlids, SoftDeletes;

    /**
     * The reader's relation to the crew, set for a whole page by CrewViewerState::prepare() (never stored); null for guests and when not
     * prepared.
     *
     * @var array{role: CrewRole|null, state: 'member'|'requested'|'invited'|'none', invite_id: string|null, request_id: string|null}|null
     */
    public ?array $viewer = null;

    /**
     * Open requests and invitations, set by CrewViewerState::prepare() for founder and admins only (never stored).
     */
    public ?int $pendingRequests = null;

    public ?int $openInvites = null;

    /** @var list<string> */
    protected $fillable = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'bundesland' => Bundesland::class,
            'join_mode' => CrewJoinMode::class,
            'status' => CrewStatus::class,
            'ended_reason' => CrewEndReason::class,
            'hidden_at' => 'immutable_datetime',
            'removed_at' => 'immutable_datetime',
            'members_count' => 'integer',
            'is_sample' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    public function isActive(): bool
    {
        return $this->status === CrewStatus::Active && ! $this->trashed();
    }

    /**
     * The member's role in this crew, or null when they are none (one query; lists use CrewViewerState instead).
     */
    public function roleOf(?User $user): ?CrewRole
    {
        if ($user === null) {
            return null;
        }

        // value() applies the model's cast: the role comes back as a CrewRole.
        $role = CrewMember::query()->where('crew_id', $this->id)->where('user_id', $user->id)->value('role');

        return match (true) {
            $role instanceof CrewRole => $role,
            is_string($role) => CrewRole::from($role),
            default => null,
        };
    }

    /**
     * @return HasMany<CrewMember, $this>
     */
    public function members(): HasMany
    {
        return $this->hasMany(CrewMember::class);
    }

    /**
     * @return HasOne<CrewMember, $this>
     */
    public function founderMembership(): HasOne
    {
        return $this->hasOne(CrewMember::class)->where('role', CrewRole::Founder->value);
    }

    /**
     * @return HasMany<CrewRequest, $this>
     */
    public function requests(): HasMany
    {
        return $this->hasMany(CrewRequest::class);
    }

    /**
     * @return HasMany<CrewInvite, $this>
     */
    public function invites(): HasMany
    {
        return $this->hasMany(CrewInvite::class);
    }

    /**
     * @return BelongsTo<Media, $this>
     */
    public function logo(): BelongsTo
    {
        return $this->belongsTo(Media::class, 'logo_media_id');
    }

    /**
     * @return BelongsTo<Media, $this>
     */
    public function cover(): BelongsTo
    {
        return $this->belongsTo(Media::class, 'cover_media_id');
    }

    /**
     * The founder's account (null only in the moment between a founder leaving and the hand-over, which the Actions never commit).
     */
    public function founder(): ?User
    {
        $membership = $this->relationLoaded('founderMembership') ? $this->founderMembership : $this->founderMembership()->with('user')->first();

        return $membership?->user;
    }
}
