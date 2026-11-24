<?php

namespace App\Services\Crews;

use App\Models\Crew;
use Illuminate\Support\Str;

/**
 * Crew names and slugs (contract-crews.md §4, C7): the name is trimmed with its inner whitespace collapsed; its key (lower case) makes
 * names unique case-insensitively; the slug comes from the name, unique against every crew's slug and previous slug (deleted crews
 * included, so an old link never leads to another crew).
 */
final class CrewNames
{
    /** Letters (any script), digits, spaces and - _ . & ' ! */
    private const ALLOWED = "/\\A[\\p{L}\\p{N} \\-_.&'!]+\\z/u";

    public const SLUG_MAX = 64;

    public static function normalise(string $name): string
    {
        return trim((string) preg_replace('/\s+/u', ' ', $name));
    }

    public static function key(string $name): string
    {
        return mb_strtolower(self::normalise($name));
    }

    public static function hasAllowedCharacters(string $name): bool
    {
        return preg_match(self::ALLOWED, $name) === 1 && preg_match('/[\p{L}\p{N}]/u', $name) === 1;
    }

    /**
     * A name that would pass for the platform or an app path: compared on the key and on the slug.
     */
    public static function isReserved(string $name): bool
    {
        $reserved = array_map(fn (mixed $word): string => mb_strtolower((string) $word), config()->array('speedclub.crews.reserved_names'));
        $slugs = array_map(fn (string $word): string => Str::slug($word), $reserved);

        return in_array(self::key($name), $reserved, true) || in_array(Str::slug($name), $slugs, true);
    }

    public static function isTaken(string $name, ?Crew $except = null): bool
    {
        return Crew::withTrashed()->where('name_key', self::key($name))
            ->when($except !== null, fn ($query) => $query->whereKeyNot($except?->id))
            ->exists();
    }

    /**
     * A free slug for $name: "nordlicht-crew", else "nordlicht-crew-2", "-3", …; never one another crew uses or used.
     */
    public static function slugFor(string $name, ?Crew $except = null): string
    {
        $base = Str::limit(Str::slug($name), self::SLUG_MAX - 4, '') ?: 'crew';
        $base = rtrim($base, '-') ?: 'crew';

        for ($n = 1; $n < 1000; $n++) {
            $slug = $n === 1 ? $base : $base.'-'.$n;

            if (! self::slugUsed($slug, $except)) {
                return $slug;
            }
        }

        return $base.'-'.Str::lower(Str::random(6));
    }

    private static function slugUsed(string $slug, ?Crew $except): bool
    {
        return Crew::withTrashed()
            ->where(fn ($query) => $query->where('slug', $slug)->orWhere('previous_slug', $slug))
            ->when($except !== null, fn ($query) => $query->whereKeyNot($except?->id))
            ->exists();
    }
}
