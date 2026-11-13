<?php

namespace App\Models;

use App\Enums\EventLocationVisibility;
use App\Enums\EventStatus;
use App\Enums\EventType;
use App\Enums\EventVisibility;
use App\Enums\RsvpStatus;
use Carbon\CarbonImmutable;
use Database\Factories\EventFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphMany;

/**
 * A meet (09 §8.7, EVT-01…06). Organised by a member (a verified business from M4.14 on). Status, review, reminder and removal columns
 * are not fillable: only Actions change them, through forceFill. Routes find an event by its slug.
 *
 * The exact place (venue_name, street, postcode, lat, lng) never leaves the server for a reader who may not see it
 * (EventLocation::exactFor): an after_rsvp event shows everybody but the organiser and going members only city and the area point.
 *
 * @property string $id
 * @property string $organiser_id
 * @property string $slug
 * @property string $title
 * @property EventType $type
 * @property EventStatus $status
 * @property EventVisibility $visibility
 * @property EventLocationVisibility $location_visibility
 * @property CarbonImmutable|null $starts_at
 * @property CarbonImmutable|null $ends_at
 * @property string|null $city
 * @property int|null $capacity
 * @property list<string>|null $rules
 * @property bool $is_sample
 * @property-read User $organiser
 */
class Event extends Model
{
    /** @use HasFactory<EventFactory> */
    use HasFactory, HasUlids;

    /**
     * Going, interested and waitlist counts, set by EventPresenter for a page (never stored).
     *
     * @var array{going: int, interested: int, waitlist: int}|null
     */
    public ?array $rsvpCounts = null;

    /**
     * Up to three going members for the EventCard's avatar row, set by EventPresenter (never stored); null when not prepared.
     *
     * @var list<User>|null
     */
    public ?array $attendeePreview = null;

    /** @var list<string> */
    protected $fillable = [
        'title', 'type', 'visibility', 'location_visibility', 'starts_at', 'ends_at', 'venue_name', 'street', 'postcode', 'city', 'country',
        'lat', 'lng', 'description', 'organiser_rules', 'rules', 'capacity',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'type' => EventType::class,
            'status' => EventStatus::class,
            'visibility' => EventVisibility::class,
            'location_visibility' => EventLocationVisibility::class,
            'starts_at' => 'immutable_datetime',
            'ends_at' => 'immutable_datetime',
            'lat' => 'float',
            'lng' => 'float',
            'area_lat' => 'float',
            'area_lng' => 'float',
            'rules' => 'array',
            'rules_accepted_at' => 'immutable_datetime',
            'capacity' => 'integer',
            'cancelled_at' => 'immutable_datetime',
            'cancelled_by_staff' => 'boolean',
            'reviewed_at' => 'immutable_datetime',
            'review_changes' => 'array',
            'submitted_at' => 'immutable_datetime',
            'published_at' => 'immutable_datetime',
            'removed_at' => 'immutable_datetime',
            'reminded_24h_at' => 'immutable_datetime',
            'reminded_2h_at' => 'immutable_datetime',
            'is_sample' => 'boolean',
        ];
    }

    public function getRouteKeyName(): string
    {
        return 'slug';
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function organiser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'organiser_id');
    }

    /**
     * @return BelongsTo<Media, $this>
     */
    public function cover(): BelongsTo
    {
        return $this->belongsTo(Media::class, 'cover_media_id');
    }

    /**
     * @return MorphMany<Media, $this>
     */
    public function media(): MorphMany
    {
        return $this->morphMany(Media::class, 'mediable');
    }

    /**
     * @return HasMany<EventRsvp, $this>
     */
    public function rsvps(): HasMany
    {
        return $this->hasMany(EventRsvp::class);
    }

    /**
     * @return HasMany<EventUpdate, $this>
     */
    public function updates(): HasMany
    {
        return $this->hasMany(EventUpdate::class);
    }

    /**
     * @return BelongsTo<Staff, $this>
     */
    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(Staff::class, 'reviewed_by');
    }

    public function isOrganisedBy(?User $user): bool
    {
        return $user !== null && $this->organiser_id === $user->id;
    }

    public function hasEnded(): bool
    {
        return $this->ends_at !== null && $this->ends_at->isPast();
    }

    /**
     * Published, not over: members can still answer, the organiser can still post updates.
     */
    public function isOpen(): bool
    {
        return $this->status === EventStatus::Published && ! $this->hasEnded();
    }

    /**
     * The viewer's own answer, loaded or looked up; null without one (removed rows count as none).
     */
    public function rsvpOf(?User $user): ?EventRsvp
    {
        if ($user === null) {
            return null;
        }

        if ($this->relationLoaded('viewerRsvp')) {
            $rsvp = $this->getRelation('viewerRsvp');

            return $rsvp instanceof EventRsvp && (string) $rsvp->user_id === (string) $user->id ? $rsvp : null;
        }

        return $this->rsvps()->where('user_id', $user->id)->first();
    }

    public function isGoing(?User $user): bool
    {
        $rsvp = $this->rsvpOf($user);

        return $rsvp !== null && $rsvp->removed_at === null && $rsvp->status === RsvpStatus::Going;
    }
}
