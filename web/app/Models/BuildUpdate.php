<?php

namespace App\Models;

use App\Enums\BuildUpdateAudience;
use App\Enums\BuildUpdateType;
use Carbon\CarbonInterface;
use Database\Factories\BuildUpdateFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Database\Query\Builder as QueryBuilder;

/**
 * An entry of a build's Verlauf: recorded from a change (BuildUpdates) or written by the owner (a note, or since M4.11 a post with
 * photos, linked mods, mileage, date and audience, 09 §8.5). A followers-only post is seen by the owner and by members following the
 * owner or the vehicle (scopeVisibleTo); a hidden entry by the owner only.
 *
 * @property string $id
 * @property string $vehicle_id
 * @property bool $hidden
 * @property BuildUpdateType $type
 * @property BuildUpdateAudience $audience
 * @property array<string, mixed>|null $payload
 * @property list<array{0: string, 1: string}>|null $photo_pairs
 * @property int|null $mileage_km
 * @property CarbonInterface|null $happened_on
 * @property CarbonInterface|null $edited_at
 * @property bool $is_sample
 * @property Vehicle $vehicle
 */
#[Fillable(['type', 'payload', 'note', 'hidden', 'mileage_km', 'happened_on', 'audience'])]
class BuildUpdate extends Model
{
    /** @use HasFactory<BuildUpdateFactory> */
    use HasFactory, HasUlids;

    public const UPDATED_AT = null;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'type' => BuildUpdateType::class,
            'payload' => 'array',
            'hidden' => 'boolean',
            'open_until' => 'datetime',
            'audience' => BuildUpdateAudience::class,
            'photo_pairs' => 'array',
            'mileage_km' => 'integer',
            'happened_on' => 'date',
            'edited_at' => 'datetime',
            'is_sample' => 'boolean',
        ];
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class)->withTrashed();
    }

    /**
     * M4.11: the update's own photos (up to 10), in their order.
     *
     * @return MorphMany<Media, $this>
     */
    public function photos(): MorphMany
    {
        return $this->morphMany(Media::class, 'mediable')->orderBy('sort')->orderBy('id');
    }

    /**
     * M4.11: the mods the update is about, in the owner's order.
     *
     * @return BelongsToMany<Modification, $this>
     */
    public function modifications(): BelongsToMany
    {
        return $this->belongsToMany(Modification::class, 'build_update_modifications')->withPivot('position')->orderByPivot('position');
    }

    /**
     * @return HasMany<Comment, $this>
     */
    public function comments(): HasMany
    {
        return $this->hasMany(Comment::class);
    }

    /**
     * Entries $viewer may read on a vehicle's Verlauf: the owner everything, anybody else what is not hidden and, for a followers-only
     * post, only while following the owner or the vehicle. Whether the vehicle itself may be seen is the caller's (VehiclePolicy).
     *
     * @param  Builder<BuildUpdate>  $query
     */
    public function scopeVisibleTo(Builder $query, ?User $viewer, Vehicle $vehicle): void
    {
        self::restrictTo($query, $viewer, $vehicle);
    }

    /**
     * scopeVisibleTo as a plain call, for list routes whose OpenAPI export must still see the paginator they build.
     *
     * @param  Builder<BuildUpdate>  $query
     */
    public static function restrictTo(Builder $query, ?User $viewer, Vehicle $vehicle): void
    {
        if ($vehicle->isOwnedBy($viewer)) {
            return;
        }

        $query->where('build_updates.hidden', false);

        if ($viewer === null) {
            $query->where('build_updates.audience', BuildUpdateAudience::Vehicle->value);

            return;
        }

        $following = Follow::query()->where('follower_id', $viewer->id)->where('followee_id', $vehicle->owner_id)->exists()
            || VehicleFollow::query()->where('user_id', $viewer->id)->where('vehicle_id', $vehicle->id)->exists();

        if (! $following) {
            $query->where('build_updates.audience', BuildUpdateAudience::Vehicle->value);
        }
    }

    /**
     * The audience rule on any query: followers-only rows only for the owner and for a viewer following the owner or the vehicle. Guests
     * see public audiences only. $ownerColumn and $vehicleColumn are qualified columns of the query ("v.owner_id", "bu.vehicle_id").
     */
    public static function audienceFor(QueryBuilder $query, ?User $viewer, string $audienceColumn, string $vehicleColumn, string $ownerColumn): QueryBuilder
    {
        if ($viewer === null) {
            return $query->where($audienceColumn, BuildUpdateAudience::Vehicle->value);
        }

        return $query->where(fn (QueryBuilder $audience) => $audience
            ->where($audienceColumn, BuildUpdateAudience::Vehicle->value)
            ->orWhere($ownerColumn, $viewer->id)
            ->orWhereExists(fn (QueryBuilder $follows) => $follows->selectRaw('1')->from('follows', 'af')
                ->where('af.follower_id', $viewer->id)
                ->whereColumn('af.followee_id', $ownerColumn))
            ->orWhereExists(fn (QueryBuilder $follows) => $follows->selectRaw('1')->from('vehicle_follows', 'avf')
                ->where('avf.user_id', $viewer->id)
                ->whereColumn('avf.vehicle_id', $vehicleColumn)));
    }

    /**
     * Whether $viewer may read this update in the audience sense (not the vehicle's visibility, not hidden): the owner, everybody for
     * a public audience, followers of the owner or of the vehicle for a followers-only post.
     */
    public function reaches(?User $viewer): bool
    {
        $vehicle = $this->vehicle;

        if ($vehicle->isOwnedBy($viewer)) {
            return true;
        }

        // The column, not Eloquent's $hidden property (which $this->hidden reads inside the model).
        if ($this->getAttribute('hidden') === true) {
            return false;
        }

        if ($this->audience !== BuildUpdateAudience::Followers) {
            return true;
        }

        return $viewer !== null && (
            Follow::query()->where('follower_id', $viewer->id)->where('followee_id', $vehicle->owner_id)->exists()
            || VehicleFollow::query()->where('user_id', $viewer->id)->where('vehicle_id', $vehicle->id)->exists()
        );
    }

    /**
     * Whether the owner may still edit text, photos, mods, mileage, date and audience (09 §8.5: within 24 hours of posting).
     */
    public function isEditable(): bool
    {
        $created = $this->getAttribute('created_at');

        return $this->type->isAuthored()
            && $created instanceof CarbonInterface
            && $created->greaterThan(now()->subHours(config()->integer('speedclub.social_2.update_edit_hours')));
    }
}
