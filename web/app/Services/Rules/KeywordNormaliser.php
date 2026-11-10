<?php

namespace App\Services\Rules;

use Illuminate\Support\Str;

/**
 * The normal form keyword rules match on (m3.4-contract §1: SearchTerms-style folding, word boundaries). Text and term are folded to
 * lowercase ASCII both ways German letters are written ("Müll" → "muell" and "mull"), punctuation becomes a word break, and a term
 * matches only whole words: "scam" finds "SCAM!" and "Scam-Shop" but not "Scampi". A one-word term also matches the word with its
 * punctuation removed, so "s-c-a-m" or "s.c.a.m" do not slip past "scam".
 */
final class KeywordNormaliser
{
    public const TERM_MAX = 100;

    /** What the rule stores and compares for uniqueness (the German fold, words joined by one space). */
    public static function term(string $term): string
    {
        return self::spaced(self::fold($term, 'de'));
    }

    /**
     * The forms a term is looked for in.
     *
     * @return list<string>
     */
    public static function termForms(string $term): array
    {
        return array_values(array_unique(array_filter([self::spaced(self::fold($term, 'de')), self::spaced(self::fold($term, null))], fn (string $form): bool => $form !== '')));
    }

    /**
     * The forms of a text: " w1 w2 … " with a space at both ends, in both folds, plus the joined form of each written word.
     *
     * @return list<string>
     */
    public static function textForms(string $text): array
    {
        $forms = [];

        foreach (['de', null] as $language) {
            $folded = self::fold($text, $language);
            $forms[] = ' '.self::spaced($folded).' ';
            $joined = array_map(fn (string $word): string => (string) preg_replace('/[^a-z0-9]+/', '', $word), preg_split('/\s+/', $folded, -1, PREG_SPLIT_NO_EMPTY) ?: []);
            $forms[] = ' '.implode(' ', array_filter($joined, fn (string $word): bool => $word !== '')).' ';
        }

        return array_values(array_unique($forms));
    }

    /**
     * @param  list<string>  $textForms
     */
    public static function matches(array $textForms, string $term): bool
    {
        foreach (self::termForms($term) as $form) {
            foreach ($textForms as $text) {
                if (str_contains($text, ' '.$form.' ')) {
                    return true;
                }
            }
        }

        return false;
    }

    private static function fold(string $text, ?string $language): string
    {
        $text = self::visible($text);

        return strtolower($language === null ? Str::ascii($text) : Str::ascii($text, $language));
    }

    /**
     * SEC-P3-15: what a reader sees. Invisible format characters (zero-width space and joiners, word joiner, soft hyphen, bidi marks:
     * Unicode category Cf) go, so "Dark\u{200B}net" is one word again; compatibility forms (fullwidth "Ｄａｒｋ", ligatures, circled
     * letters) become their plain letters through NFKC. Without the intl extension, fullwidth ASCII is mapped by hand.
     */
    private static function visible(string $text): string
    {
        $text = (string) preg_replace('/\p{Cf}+/u', '', $text);

        if (class_exists(\Normalizer::class)) {
            $normalized = \Normalizer::normalize($text, \Normalizer::FORM_KC);

            return is_string($normalized) ? $normalized : $text;
        }

        return (string) preg_replace_callback('/[\x{FF01}-\x{FF5E}]/u', fn (array $match): string => chr(mb_ord($match[0]) - 0xFEE0), $text);
    }

    private static function spaced(string $folded): string
    {
        return trim((string) preg_replace('/[^a-z0-9]+/', ' ', $folded));
    }
}
