<?php

namespace App\Services\Ai;

use App\Enums\AiFeature;
use App\Enums\AiOutcome;
use App\Enums\ForumThreadStatus;
use App\Enums\KeywordList;
use App\Models\Block;
use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\ForumThreadSummary;
use App\Models\User;
use App\Services\Ai\Agents\ForumSummaryAgent;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Forum\ForumVisibility;
use App\Services\Rules\KeywordRules;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Throwable;

/**
 * ai.forum_summary (10 §8.4, m5.9-contract §2.3, lead D-3): the 3-line "KI-Zusammenfassung" of a forum thread with more than 20 visible
 * replies, built in the background by forum:summaries — no member triggers a call, so the feature's global daily budget is the bound.
 *
 * What goes to the provider: the thread's title and the plain text of the opening post and of at most `max_posts` newest replies that a
 * guest may see (published, not deleted, publicly visible non-sample authors; ForumVisibility), each cut to `post_chars`, with mentions
 * replaced by "ein Mitglied", links and Markdown markup removed. Never a username, display name, photo or attachment. A line that still
 * names an author, carries a link (also a bare domain such as "teile-discount.de") or a number that is not in the posts, or holds a term
 * of the ADM-23 keyword rules (block or flag list, the rules every forum text passes) is dropped; fewer than 2 lines → no summary
 * (outcome invalid).
 *
 * Fresh: rebuilt after `refresh_after_replies` new replies, or after `refresh_days` with new replies. sweep() drops a summary whose thread
 * is no longer published or one of whose posts was removed, deleted or hidden since (it is rebuilt by the next run without it); until
 * then forReader() already shows nobody a summary one of whose posts a guest can no longer see (SEC-P5-10: a post staff hide or remove
 * takes the summary down at once, not at the next run). A reader who has a block (either way) with one of the authors that went in
 * does not see it (forReader()).
 */
final class ForumSummaries
{
    public const LOCK = 'forum:summaries:lock';

    /** A bare domain in a line (SEC-P5-10): treated like a link. */
    private const DOMAIN = '~\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:de|com|net|org|eu|at|ch|shop|store|info|io|co|biz|online|xyz|me|app|top|ru|cn)\b~i';

    public function __construct(
        private readonly AiGateway $gateway,
        private readonly FeatureFlags $flags,
        private readonly ForumVisibility $visibility,
        private readonly KeywordRules $rules,
    ) {}

    public function enabled(): bool
    {
        return $this->gateway->enabled(AiFeature::ForumSummary) && $this->flags->enabled('forum');
    }

    /**
     * @return int|null summaries written, null while another run holds the lock
     */
    public function run(): ?int
    {
        if (! $this->enabled()) {
            return 0;
        }

        $lock = Cache::lock(self::LOCK, 120);

        if (! $lock->get()) {
            return null;
        }

        try {
            $this->sweep();

            return $this->build();
        } finally {
            $lock->release();
        }
    }

    /**
     * Deletes summaries that must not be shown any more: the thread is not published, or a post that went in is no longer visible to a
     * guest. Returns how many.
     */
    public function sweep(): int
    {
        $dropped = 0;

        ForumThreadSummary::query()->orderBy('thread_id')->chunk(200, function ($summaries) use (&$dropped): void {
            foreach ($summaries as $summary) {
                /** @var ForumThreadSummary $summary */
                $thread = ForumThread::query()->find($summary->thread_id);
                $postIds = $summary->post_ids;
                $visible = $postIds === [] ? 0 : $this->visiblePosts($summary->thread_id)->whereIn('forum_posts.id', $postIds)->count();

                if (! $thread instanceof ForumThread || $thread->status !== ForumThreadStatus::Published || $visible !== count($postIds)) {
                    ForumThreadSummary::query()->whereKey($summary->thread_id)->delete();
                    $dropped++;
                }
            }
        });

        return $dropped;
    }

    /**
     * The summary for $reader, or null: feature off, thread not published or too short, no summary yet, or a block between the reader and
     * one of the authors whose posts went in.
     *
     * @return array{lines: list<string>, based_on_replies: int, generated_at: string}|null
     */
    public function forReader(ForumThread $thread, ?User $reader): ?array
    {
        if ($thread->status !== ForumThreadStatus::Published || (int) $thread->getAttribute('replies_count') < $this->config('min_replies') || ! $this->enabled()) {
            return null;
        }

        $summary = ForumThreadSummary::query()->find($thread->id);

        if (! $summary instanceof ForumThreadSummary) {
            return null;
        }

        // A post that went in and is no longer visible to a guest (hidden, removed, deleted, back in review) takes the summary down now.
        $postIds = $summary->post_ids;

        if ($postIds !== [] && $this->visiblePosts($thread->id)->whereIn('forum_posts.id', $postIds)->count() !== count($postIds)) {
            return null;
        }

        if ($reader !== null && $summary->author_ids !== []) {
            $blocked = Block::query()
                ->where(fn ($either) => $either
                    ->where(fn ($mine) => $mine->where('blocker_id', $reader->id)->whereIn('blocked_id', $summary->author_ids))
                    ->orWhere(fn ($theirs) => $theirs->where('blocked_id', $reader->id)->whereIn('blocker_id', $summary->author_ids)))
                ->exists();

            if ($blocked) {
                return null;
            }
        }

        return ['lines' => $summary->lines, 'based_on_replies' => $summary->based_on_replies, 'generated_at' => $summary->generated_at->toIso8601String()];
    }

    /**
     * Builds the summaries that are due, `chunk` threads at a time, until done or `seconds` are used.
     */
    private function build(): int
    {
        $deadline = microtime(true) + $this->config('seconds');
        $written = 0;
        $tried = [];

        while (microtime(true) < $deadline) {
            $threads = $this->due()->whereNotIn('forum_threads.id', $tried)->limit(max(1, $this->config('chunk')))->get();

            if ($threads->isEmpty()) {
                break;
            }

            foreach ($threads as $thread) {
                $tried[] = $thread->id;

                try {
                    $written += $this->summarise($thread) ? 1 : 0;
                } catch (AiFailed $failed) {
                    // A refused or unusable answer concerns this thread only; a spent budget or a provider failure ends the run (retried later).
                    if (! in_array($failed->outcome, [AiOutcome::Refused, AiOutcome::Invalid], true)) {
                        return $written;
                    }
                } catch (Throwable $error) {
                    report($error);
                }

                if (microtime(true) >= $deadline) {
                    break 2;
                }
            }
        }

        return $written;
    }

    /**
     * Published threads a guest may see with at least `min_replies` replies and no summary, or one that is stale.
     *
     * @return Builder<ForumThread>
     */
    private function due(): Builder
    {
        $stale = CarbonImmutable::now()->subDays($this->config('refresh_days'));

        return $this->visibility->threads(null)
            ->where('forum_threads.replies_count', '>=', $this->config('min_replies'))
            ->where(fn (Builder $due) => $due
                ->whereNotExists(fn ($none) => $none->selectRaw('1')->from('forum_thread_summaries', 's')->whereColumn('s.thread_id', 'forum_threads.id'))
                ->orWhereExists(fn ($old) => $old->selectRaw('1')->from('forum_thread_summaries', 's')->whereColumn('s.thread_id', 'forum_threads.id')
                    ->where(fn ($why) => $why
                        ->whereRaw('forum_threads.replies_count >= s.based_on_replies + ?', [$this->config('refresh_after_replies')])
                        ->orWhere(fn ($aged) => $aged->where('s.generated_at', '<', $stale)->whereColumn('forum_threads.replies_count', '>', 's.based_on_replies')))))
            ->orderBy('forum_threads.last_activity_at', 'desc')
            ->orderBy('forum_threads.id');
    }

    private function summarise(ForumThread $thread): bool
    {
        $opening = $this->visiblePosts($thread->id)->where('forum_posts.is_opening', true)->first();
        $replies = $this->visiblePosts($thread->id)->where('forum_posts.is_opening', false)
            ->orderByDesc('forum_posts.published_at')->orderByDesc('forum_posts.id')->limit($this->config('max_posts'))->get()->reverse();
        $posts = collect([$opening])->filter()->concat($replies)->values();

        if ($posts->isEmpty()) {
            return false;
        }

        $names = User::query()->whereIn('id', $posts->pluck('user_id')->unique()->all())->get(['username', 'display_name'])
            ->flatMap(fn (User $user): array => array_values(array_filter([$user->username, $user->getAttribute('display_name')], fn (mixed $name): bool => is_string($name) && mb_strlen($name) >= 3)))
            ->values()->all();
        $texts = $posts->map(fn (ForumPost $post): string => '- '.self::plain($post->body, $this->config('post_chars')))->implode("\n");
        $input = 'Thread title: '.self::plain((string) $thread->getAttribute('title'), 120)."\nPosts (oldest first):\n".$texts;

        $answer = $this->gateway->ask(AiFeature::ForumSummary, new ForumSummaryAgent, $input);
        $lines = [];

        foreach (array_slice($answer->list('lines'), 0, 3) as $line) {
            $line = is_string($line) ? trim($line) : '';

            if ($line === '' || mb_strlen($line) > 140 || preg_match('~https?://|www\.|@~i', $line) === 1 || preg_match(self::DOMAIN, $line) === 1
                || ! Numbers::allFrom($line, $input) || NeverList::violatedBy($line, $input) || self::namesAny($line, $names) || $this->screened($line)) {
                continue;
            }

            $lines[] = $line;
        }

        if (count($lines) < 2) {
            $this->gateway->markInvalid($answer);

            return false;
        }

        ForumThreadSummary::query()->updateOrCreate(['thread_id' => $thread->id], [
            'lines' => $lines,
            'based_on_replies' => (int) $thread->getAttribute('replies_count'),
            'post_ids' => $posts->pluck('id')->map(strval(...))->values()->all(),
            'author_ids' => $posts->pluck('user_id')->filter()->map(strval(...))->unique()->values()->all(),
            'ai_call_id' => $answer->callId,
            'generated_at' => now(),
        ]);

        return true;
    }

    /**
     * Posts of the thread a guest may see.
     *
     * @return Builder<ForumPost>
     */
    private function visiblePosts(string $threadId): Builder
    {
        $query = ForumPost::query()->where('forum_posts.thread_id', $threadId);
        $this->visibility->posts($query, null);

        return $query;
    }

    /**
     * A post as plain text for the prompt: no Markdown, links, images or mentions; at most $chars characters.
     */
    public static function plain(string $text, int $chars): string
    {
        $text = (string) preg_replace('/!\[[^\]]*\]\([^)]*\)/u', ' ', $text);
        $text = (string) preg_replace('/\[([^\]]*)\]\([^)]*\)/u', '$1', $text);
        $text = (string) preg_replace('~(https?://|www\.)\S+~iu', ' ', $text);
        $text = (string) preg_replace('/(?<![\w.])@[A-Za-z0-9._]{2,30}/u', 'ein Mitglied', $text);
        $text = (string) preg_replace('/[*_`#>~|]+/u', ' ', $text);
        $text = trim((string) preg_replace('/\s+/u', ' ', $text));

        return Str::limit($text, $chars, '…');
    }

    /**
     * Whether a line holds a term of the keyword rules (ADM-23), block or flag list: a line nobody reviewed is dropped rather than flagged.
     */
    private function screened(string $line): bool
    {
        return $this->rules->match($line, KeywordList::Block) !== [] || $this->rules->match($line, KeywordList::Flag) !== [];
    }

    /**
     * @param  array<int, string>  $names
     */
    private static function namesAny(string $line, array $names): bool
    {
        foreach ($names as $name) {
            if (mb_stripos($line, $name) !== false) {
                return true;
            }
        }

        return false;
    }

    private function config(string $key): int
    {
        return config()->integer('speedclub.ai.forum_summary.'.$key);
    }
}
