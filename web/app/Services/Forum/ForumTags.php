<?php

namespace App\Services\Forum;

/**
 * Thread tags (10 §7.1): lower case, letters, digits and hyphens, 2–24 characters, at most speedclub.forum.max_tags, without repeats.
 */
final class ForumTags
{
    public const PATTERN = '/\A[\p{Ll}\p{N}][\p{Ll}\p{N}-]{1,23}\z/u';

    /**
     * @param  list<string>|null  $tags
     * @return list<string>
     */
    public static function normalise(?array $tags): array
    {
        $clean = [];

        foreach ($tags ?? [] as $tag) {
            $tag = mb_strtolower(trim(ltrim(trim($tag), '#')));

            if ($tag !== '' && ! in_array($tag, $clean, true)) {
                $clean[] = $tag;
            }
        }

        return array_slice($clean, 0, config()->integer('speedclub.forum.max_tags'));
    }
}
