<?php

namespace App\Models;

use Database\Factories\MentionFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/**
 * A member named with @username in a build update or a comment (09 §8.5), stored by id so a later rename keeps the link. Only mentions
 * the member's "Wer darf mich erwähnen" allowed are stored (App\Services\Social\Mentions).
 *
 * @property int $id
 * @property string $mentionable_type
 * @property string $mentionable_id
 * @property string $mentioned_user_id
 * @property string $author_id
 */
#[Fillable(['mentionable_type', 'mentionable_id', 'mentioned_user_id', 'author_id'])]
class Mention extends Model
{
    /** @use HasFactory<MentionFactory> */
    use HasFactory;

    public const UPDATED_AT = null;

    /**
     * @return BelongsTo<User, $this>
     */
    public function mentioned(): BelongsTo
    {
        return $this->belongsTo(User::class, 'mentioned_user_id');
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }

    /**
     * @return MorphTo<Model, $this>
     */
    public function mentionable(): MorphTo
    {
        return $this->morphTo();
    }
}
