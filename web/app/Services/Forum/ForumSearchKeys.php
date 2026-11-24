<?php

namespace App\Services\Forum;

use App\Models\ForumPost;
use App\Models\ForumThread;
use App\Models\Vehicle;
use App\Services\Garage\VehiclePresenter;
use App\Services\Search\SearchTerms;
use Illuminate\Database\Eloquent\Builder;

/**
 * Search without FULLTEXT (m5.8-contract D6): SearchTerms word keys of a thread, matched by word prefix with LIKE on MySQL 8 and
 * MariaDB 10.6 alike. title_keys feeds "Ähnliche Themen"; search_keys the forum search (title, opening text, tags, category, vehicle).
 */
final class ForumSearchKeys
{
    public const TITLE_BYTES = 600;

    public const SEARCH_BYTES = 8000;

    public function __construct(
        private readonly ForumMarkdown $markdown,
        private readonly VehiclePresenter $presenter,
    ) {}

    public function refresh(ForumThread $thread): void
    {
        $thread->loadMissing('category');
        $opening = ForumPost::query()->where('thread_id', $thread->id)->where('is_opening', true)->value('body');
        $vehicle = $thread->vehicle_id === null ? null : Vehicle::query()->with(['make', 'vehicleModel', 'generation'])->find($thread->vehicle_id);

        $keys = [
            'title_keys' => SearchTerms::keys([$thread->title], self::TITLE_BYTES),
            'search_keys' => SearchTerms::keys([
                $thread->title,
                ...($thread->tags ?? []),
                $thread->category->name_de,
                $thread->category->name_en,
                $vehicle instanceof Vehicle ? $this->presenter->fullTitle($vehicle) : null,
                $this->markdown->plain(is_string($opening) ? $opening : null),
            ], self::SEARCH_BYTES),
        ];

        ForumThread::withTrashed()->whereKey($thread->id)->toBase()->update($keys);
        $thread->forceFill($keys)->syncOriginalAttributes(array_keys($keys));
    }

    /**
     * Adds one AND clause per query word: the word as a prefix of a stored word. Empty words: nothing matches.
     *
     * @param  Builder<ForumThread>  $query
     * @param  list<string>  $words
     */
    public static function match($query, array $words): void
    {
        if ($words === []) {
            $query->whereRaw('1 = 0');

            return;
        }

        foreach ($words as $word) {
            $query->whereRaw("forum_threads.search_keys LIKE ? ESCAPE '!'", ['% '.SearchTerms::escapeLike($word).'%']);
        }
    }
}
