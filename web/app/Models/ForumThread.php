<?php

namespace App\Models;

use App\Enums\ForumThreadStatus;
use Carbon\CarbonImmutable;
use Database\Factories\ForumThreadFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A forum thread (10 §7, m5.8-contract §1). Its text is the opening post (forum_posts.is_opening), so one report target, one moderation
 * path and one body model serve both. The row keeps title, category, tags, attachments, state and the denormalised counters the lists
 * sort by: replies_count (published replies, shown in the forum only), last_activity_at and the last poster.
 *
 * @property string $id
 * @property int $category_id
 * @property string|null $user_id
 * @property string $title
 * @property string $slug
 * @property ForumThreadStatus $status
 * @property list<string>|null $tags
 * @property string|null $vehicle_id
 * @property string|null $modification_id
 * @property string|null $product_id
 * @property bool $is_pinned
 * @property CarbonImmutable|null $pinned_at
 * @property bool $is_locked
 * @property CarbonImmutable|null $locked_at
 * @property string|null $solved_post_id
 * @property CarbonImmutable|null $solved_at
 * @property string|null $merged_into_id
 * @property int $replies_count
 * @property CarbonImmutable|null $last_activity_at
 * @property string|null $last_post_id
 * @property string|null $last_poster_id
 * @property string $title_keys
 * @property string|null $search_keys
 * @property CarbonImmutable|null $published_at
 * @property CarbonImmutable|null $edited_at
 * @property string|null $review_reason
 * @property int|null $reviewed_by
 * @property CarbonImmutable|null $reviewed_at
 * @property bool $is_sample
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property ForumCategory $category
 * @property User|null $user
 * @property ForumPost|null $openingPost
 */
class ForumThread extends Model
{
    /** @use HasFactory<ForumThreadFactory> */
    use HasFactory, HasUlids, SoftDeletes;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => ForumThreadStatus::class,
            'tags' => 'array',
            'is_pinned' => 'boolean',
            'is_locked' => 'boolean',
            'is_sample' => 'boolean',
            'replies_count' => 'integer',
            'pinned_at' => 'immutable_datetime',
            'locked_at' => 'immutable_datetime',
            'solved_at' => 'immutable_datetime',
            'last_activity_at' => 'immutable_datetime',
            'published_at' => 'immutable_datetime',
            'edited_at' => 'immutable_datetime',
            'reviewed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<ForumCategory, $this>
     */
    public function category(): BelongsTo
    {
        return $this->belongsTo(ForumCategory::class, 'category_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class)->withTrashed();
    }

    /**
     * @return HasOne<ForumPost, $this>
     */
    public function openingPost(): HasOne
    {
        return $this->hasOne(ForumPost::class, 'thread_id')->where('is_opening', true);
    }

    /**
     * @return HasMany<ForumPost, $this>
     */
    public function posts(): HasMany
    {
        return $this->hasMany(ForumPost::class, 'thread_id');
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class);
    }

    /**
     * @return BelongsTo<Modification, $this>
     */
    public function modification(): BelongsTo
    {
        return $this->belongsTo(Modification::class);
    }

    /**
     * @return BelongsTo<Product, $this>
     */
    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    /**
     * @return BelongsTo<ForumPost, $this>
     */
    public function solvedPost(): BelongsTo
    {
        return $this->belongsTo(ForumPost::class, 'solved_post_id');
    }

    /**
     * @return BelongsTo<ForumThread, $this>
     */
    public function mergedInto(): BelongsTo
    {
        return $this->belongsTo(self::class, 'merged_into_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function lastPoster(): BelongsTo
    {
        return $this->belongsTo(User::class, 'last_poster_id');
    }

    /**
     * @return BelongsToMany<User, $this>
     */
    public function subscribers(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'forum_subscriptions', 'thread_id', 'user_id');
    }

    public function isPublished(): bool
    {
        return $this->status === ForumThreadStatus::Published && ! $this->trashed();
    }

    public function isAuthoredBy(?User $user): bool
    {
        return $user !== null && $this->user_id !== null && $this->user_id === $user->id;
    }

    /**
     * The app path of FOR-03 ("/forum/{id}"); share links open it in the member web.
     */
    public function path(): string
    {
        return '/forum/'.$this->id;
    }
}
