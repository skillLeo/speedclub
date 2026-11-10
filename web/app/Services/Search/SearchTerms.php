<?php

namespace App\Services\Search;

use Illuminate\Support\Str;

/**
 * One normal form for the stored keys and for what a member types, so "GT-R", "gt-r" and "GTR" meet, and so do "M4", "E46" and
 * "R34" in any case (M1.8). Words are lowercase ASCII letters and digits. A word that holds separators ("GT-R", "E90/E92/E93",
 * "Levin/Trueno") is kept joined ("gtr") and in its parts ("gt", "r"). German letters are folded both ways, "ü" to "ue" and to
 * "u", so "Müller", "Mueller" and "Muller" all find each other. Matching is by word prefix: no ngram parser, nothing that only one
 * of MySQL 8 and MariaDB has (05_ARCHITECTURE §10).
 */
final class SearchTerms
{
    /** A query is cut to this many words; more would only multiply LIKE clauses. */
    public const MAX_QUERY_WORDS = 6;

    /** Longer words are cut, so a pasted paragraph stays cheap. */
    private const MAX_WORD_LENGTH = 40;

    /** Characters of a query that are read at all; the API allows 100 (speedclub.search.query_max_length). */
    private const MAX_QUERY_LENGTH = 1000;

    /**
     * Stored form: " word word … " with a space before and after each word, so " m4 " is an exact word and " m4%" a prefix.
     *
     * @param  iterable<string|null>  $phrases
     */
    public static function keys(iterable $phrases, int $maxBytes = 60_000): string
    {
        $words = [];

        foreach ($phrases as $phrase) {
            if (is_string($phrase) && $phrase !== '') {
                foreach (self::wordsOf($phrase) as $word) {
                    $words[$word] = true;
                }
            }
        }

        $keys = '';

        foreach (array_keys($words) as $word) {
            $next = $keys.' '.$word;

            if (strlen($next) + 1 > $maxBytes) {
                break;
            }

            $keys = $next;
        }

        return $keys === '' ? '' : $keys.' ';
    }

    /**
     * What a query searches for: each typed word in its joined form, at most MAX_QUERY_WORDS, duplicates dropped. A word with
     * nothing but punctuation is no word. Empty when nothing is left.
     *
     * @return list<string>
     */
    public static function queryWords(string $query): array
    {
        $words = [];

        foreach (self::splitQuery($query) as $raw) {
            $word = self::compact(self::fold($raw, 'de'));

            if ($word !== '') {
                $words[$word] = true;
            }
        }

        return array_slice(array_map(strval(...), array_keys($words)), 0, self::MAX_QUERY_WORDS);
    }

    /**
     * Words for member names: lowercase, kept as typed apart from the case, as the collation of display_name already ignores accents
     * and usernames only hold a-z 0-9 . _ (02_PRODUCT_SPEC §3.1).
     *
     * @return list<string>
     */
    public static function nameWords(string $query): array
    {
        $words = [];

        foreach (self::splitQuery($query) as $raw) {
            $word = trim(mb_strtolower($raw), '@');

            if ($word !== '' && preg_match('/[\p{L}\p{N}]/u', $word) === 1) {
                $words[mb_substr($word, 0, self::MAX_WORD_LENGTH)] = true;
            }
        }

        return array_slice(array_map(strval(...), array_keys($words)), 0, self::MAX_QUERY_WORDS);
    }

    /**
     * One typed word in its joined form ("GT-R" → "gtr", "Müller" → "mueller"), as queryWords() writes each; empty for punctuation.
     */
    public static function word(string $raw): string
    {
        return self::compact(self::fold($raw, 'de'));
    }

    /**
     * Every word a stored phrase is found by, as keys() writes them: "VII (5G)" → vii5g, vii, 5g; "E90/E92" → e90e92, e90, e92.
     *
     * @return list<string>
     */
    public static function phraseWords(string $phrase): array
    {
        return array_values(array_unique(self::wordsOf($phrase)));
    }

    /**
     * For LIKE … ESCAPE '!': the value matches itself only.
     */
    public static function escapeLike(string $value): string
    {
        return str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $value);
    }

    /**
     * @return list<string>
     */
    private static function wordsOf(string $phrase): array
    {
        $words = [];

        foreach (self::split($phrase) as $raw) {
            foreach (array_unique([self::fold($raw, 'de'), self::fold($raw, null)]) as $folded) {
                $joined = self::compact($folded);

                if ($joined === '') {
                    continue;
                }

                $words[] = $joined;

                foreach (preg_split('/[^a-z0-9]+/', $folded, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $part) {
                    $words[] = substr($part, 0, self::MAX_WORD_LENGTH);
                }
            }
        }

        return $words;
    }

    /**
     * @return list<string>
     */
    private static function split(string $text): array
    {
        return preg_split('/[\s,;]+/u', $text, -1, PREG_SPLIT_NO_EMPTY) ?: [];
    }

    /**
     * What a member typed is cut, so a pasted paragraph stays cheap. Stored text is not: keys() is bounded by its byte limit, and
     * a cut there would hide the words of a long list of mods (SEC-M18-02).
     *
     * @return list<string>
     */
    private static function splitQuery(string $query): array
    {
        return self::split(mb_substr($query, 0, self::MAX_QUERY_LENGTH));
    }

    private static function fold(string $word, ?string $language): string
    {
        return strtolower($language === null ? Str::ascii($word) : Str::ascii($word, $language));
    }

    private static function compact(string $folded): string
    {
        return substr((string) preg_replace('/[^a-z0-9]+/', '', $folded), 0, self::MAX_WORD_LENGTH);
    }
}
