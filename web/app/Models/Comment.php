<?php

namespace App\Models;

use App\Enums\CommentStatus;
use Database\Factories\CommentFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use LogicException;

/**
 * A comment on a build update or, since R5-5, on the car itself [build_comments] (09 §8.5): flat with one reply level (a reply to a
 * reply joins its parent's thread), at most 500 characters, keyword rules, rate limits, reportable (DSA pipeline). Deleted by its
 * author or the car's owner (soft delete); removed by moderation through `status`. Exactly one of build_update_id and vehicle_id is
 * set (saving refuses anything else; the migration explains why there is no CHECK constraint).
 *
 * @property string $id
 * @property string|null $build_update_id
 * @property string|null $vehicle_id
 * @property string $user_id
 * @property string|null $parent_id
 * @property string $body
 * @property CommentStatus $status
 * @property BuildUpdate|null $buildUpdate
 * @property Vehicle|null $vehicle
 * @property User|null $user
 */
#[Fillable(['body'])]
class Comment extends Model
{
    /** @use HasFactory<CommentFactory> */
    use HasFactory, HasUlids, SoftDeletes;

    protected static function booted(): void
    {
        // A data rule, not a business rule: a comment stands in one thread, an update's or a car's.
        static::saving(function (self $comment): void {
            if (($comment->build_update_id === null) === ($comment->vehicle_id === null)) {
                throw new LogicException('A comment belongs to exactly one build update or one vehicle.');
            }
        });
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['status' => CommentStatus::class];
    }

    /**
     * @return BelongsTo<BuildUpdate, $this>
     */
    public function buildUpdate(): BelongsTo
    {
        return $this->belongsTo(BuildUpdate::class);
    }

    /**
     * R5-5: the car of a comment on the car itself; null for a comment on an update (threadVehicle() covers both).
     *
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class)->withTrashed();
    }

    /**
     * The car the thread belongs to: the comment's own, or its update's. Null only when that row is gone.
     */
    public function threadVehicle(): ?Vehicle
    {
        if ($this->vehicle_id !== null) {
            return $this->vehicle;
        }

        return $this->buildUpdate?->vehicle;
    }

    /**
     * The id of that car without loading it (one query at most).
     */
    public function threadVehicleId(): ?string
    {
        if ($this->vehicle_id !== null) {
            return $this->vehicle_id;
        }

        $id = $this->buildUpdate()->withoutGlobalScopes()->value('vehicle_id');

        return $id === null ? null : (string) $id;
    }

    public function isOnVehicle(): bool
    {
        return $this->vehicle_id !== null;
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class)->withTrashed();
    }

    /**
     * @return BelongsTo<Comment, $this>
     */
    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    /**
     * @return HasMany<Comment, $this>
     */
    public function replies(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id');
    }

    /**
     * The replies a list shows; CommentController narrows them to what the viewer may see.
     *
     * @return HasMany<Comment, $this>
     */
    public function visibleReplies(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id');
    }
}
