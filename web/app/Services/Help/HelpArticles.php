<?php

namespace App\Services\Help;

use App\Models\HelpArticle;
use Illuminate\Support\Collection;

/**
 * SET-14. One row per key and locale; a key without a row in the requested locale falls back to German, the binding language.
 */
final class HelpArticles
{
    /**
     * @return Collection<int, HelpArticle>
     */
    public function all(string $locale): Collection
    {
        $rows = HelpArticle::query()
            ->where('published', true)
            ->whereIn('locale', array_unique([$locale, 'de']))
            ->orderBy('sort')
            ->orderBy('key')
            ->get();

        return $rows->groupBy('key')
            ->map(fn (Collection $versions): ?HelpArticle => $versions->firstWhere('locale', $locale) ?? $versions->first())
            ->filter()
            ->sortBy(fn (HelpArticle $article): array => [$article->sort, $article->key])
            // The bound counts articles (keys), not rows: a key in two languages is one article (review nit 21).
            ->take(config()->integer('speedclub.help.max_articles'))
            ->values();
    }

    public function find(string $key, string $locale): ?HelpArticle
    {
        if (preg_match('/\A[a-z0-9][a-z0-9-]{0,63}\z/', $key) !== 1) {
            return null;
        }

        return HelpArticle::query()
            ->where('key', $key)
            ->where('published', true)
            ->whereIn('locale', array_unique([$locale, 'de']))
            ->orderByRaw('locale = ? desc', [$locale])
            ->first();
    }
}
