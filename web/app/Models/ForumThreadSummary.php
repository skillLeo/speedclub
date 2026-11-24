<?php

namespace App\Models;

use Database\Factories\ForumThreadSummaryFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * M5.9 (10 §8.4, m5.9-contract §2.3): the 3-line "KI-Zusammenfassung" of a thread with more than 20 replies, built in the background
 * from the public text of its published posts (never names, mentions, links or photos). post_ids and author_ids say what went in: a reader
 * with a block on one of those authors does not see it, and a removed or deleted post makes the next run drop and rebuild it.
 *
 * @property string $thread_id
 * @property list<string> $lines
 * @property int $based_on_replies
 * @property list<string> $post_ids
 * @property list<string> $author_ids
 * @property string|null $ai_call_id
 * @property Carbon $generated_at
 */
#[Table(key: 'thread_id', keyType: 'string', incrementing: false)]
#[Fillable(['thread_id', 'lines', 'based_on_replies', 'post_ids', 'author_ids', 'ai_call_id', 'generated_at'])]
class ForumThreadSummary extends Model
{
    /** @use HasFactory<ForumThreadSummaryFactory> */
    use HasFactory;

    public $timestamps = false;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['lines' => 'array', 'post_ids' => 'array', 'author_ids' => 'array', 'generated_at' => 'datetime', 'based_on_replies' => 'integer'];
    }

    /**
     * @return BelongsTo<ForumThread, $this>
     */
    public function thread(): BelongsTo
    {
        return $this->belongsTo(ForumThread::class, 'thread_id');
    }
}
