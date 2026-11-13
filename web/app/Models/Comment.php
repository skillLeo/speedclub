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

/**
 * A comment on a build update [build_comments] (09 §8.5): flat with one reply level (a reply to a reply joins its parent's thread), at
 * most 500 characters, keyword rules, rate limits, reportable (DSA pipeline). Deleted by its author or the update's owner (soft delete);
 * removed by moderation through `status`.
 *
 * @property string $id
 * @property string $build_update_id
 * @property string $user_id
 * @property string|null $parent_id
 * @property string $body
 * @property CommentStatus $status
 * @property BuildUpdate $buildUpdate
 * @property User|null $user
 */
#[Fillable(['body'])]
class Comment extends Model
{
    /** @use HasFactory<CommentFactory> */
    use HasFactory, HasUlids, SoftDeletes;

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
