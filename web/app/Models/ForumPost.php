<?php

namespace App\Models;

use App\Enums\ForumPostStatus;
use App\Services\Forum\ForumMarkdown;
use Carbon\CarbonImmutable;
use Database\Factories\ForumPostFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * A forum post (m5.8-contract §1): a thread's opening post (is_opening, its photos hang here) or a reply, with one level of nesting (a
 * reply to a reply joins its top-level reply). Markdown subset in `body` (ForumMarkdown). helpful_count is the "Hilfreich" count, shown
 * in the forum only (ADR-506). Reportable as target `forum_post` (DSA pipeline); removed by moderation through `status`, deleted by its
 * author (soft delete).
 *
 * @property string $id
 * @property string $thread_id
 * @property string $user_id
 * @property string|null $parent_id
 * @property bool $is_opening
 * @property string $body
 * @property list<array<string, mixed>>|null $content the parsed Markdown tree (ForumMarkdown::blocks), stored with every write of `body`
 * @property ForumPostStatus $status
 * @property int $helpful_count
 * @property CarbonImmutable|null $published_at
 * @property CarbonImmutable|null $edited_at
 * @property string|null $review_reason
 * @property int|null $reviewed_by
 * @property CarbonImmutable|null $reviewed_at
 * @property bool $is_sample
 * @property CarbonImmutable|null $created_at
 * @property CarbonImmutable|null $updated_at
 * @property ForumThread $thread
 * @property User|null $user
 * @property ForumPost|null $parent
 */
class ForumPost extends Model
{
    /** @use HasFactory<ForumPostFactory> */
    use HasFactory, HasUlids, SoftDeletes;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => ForumPostStatus::class,
            'content' => 'array',
            'is_opening' => 'boolean',
            'is_sample' => 'boolean',
            'helpful_count' => 'integer',
            'published_at' => 'immutable_datetime',
            'edited_at' => 'immutable_datetime',
            'reviewed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<ForumThread, $this>
     */
    public function thread(): BelongsTo
    {
        return $this->belongsTo(ForumThread::class, 'thread_id')->withTrashed();
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class)->withTrashed();
    }

    /**
     * @return BelongsTo<ForumPost, $this>
     */
    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id')->withTrashed();
    }

    /**
     * @return HasMany<ForumPost, $this>
     */
    public function replies(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id');
    }

    /**
     * The answers a list shows; the controllers narrow them to what the viewer may see.
     *
     * @return HasMany<ForumPost, $this>
     */
    public function visibleReplies(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id');
    }

    /**
     * Photos of an opening post (≤ 6).
     *
     * @return MorphMany<Media, $this>
     */
    public function photos(): MorphMany
    {
        return $this->morphMany(Media::class, 'mediable')->orderBy('sort')->orderBy('id');
    }

    /**
     * The text and its parsed tree, always together (review SF-5): every writer of a post's text goes through here.
     */
    public function writeBody(string $body): static
    {
        return $this->forceFill(['body' => $body, 'content' => app(ForumMarkdown::class)->blocks($body)]);
    }

    /**
     * The stored tree; parsed on the fly for a row written before the column existed.
     *
     * @return list<array<string, mixed>>
     */
    public function contentTree(): array
    {
        $content = $this->content;

        return is_array($content) ? $content : app(ForumMarkdown::class)->blocks($this->body);
    }

    public function isPublished(): bool
    {
        return $this->status === ForumPostStatus::Published && ! $this->trashed();
    }
}
