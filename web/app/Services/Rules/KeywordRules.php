<?php

namespace App\Services\Rules;

use App\Enums\KeywordField;
use App\Enums\KeywordList;
use App\Models\KeywordRule;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * The keyword lists of ADM-23, read from the cache (flushed on every change) and matched against a member write. Counting a hit writes
 * the day's counter per rule and field: no member, no text (ADM-23 "Treffer 30 Tage").
 */
class KeywordRules
{
    public const CACHE_KEY = 'moderation:keyword-rules:v1';

    /**
     * @return list<array{id: int, term: string, list: string}>
     */
    public function all(): array
    {
        try {
            /** @var list<array{id: int, term: string, list: string}> $rules */
            $rules = Cache::rememberForever(self::CACHE_KEY, fn (): array => KeywordRule::query()->orderBy('id')->get(['id', 'term', 'list'])
                ->map(fn (KeywordRule $rule): array => ['id' => $rule->id, 'term' => $rule->term, 'list' => $rule->list->value])->values()->all());

            return $rules;
        } catch (Throwable $exception) {
            // A broken cache or a missing table must not take member writes down: no rules then, and the fault is reported.
            report($exception);

            return [];
        }
    }

    public function flush(): void
    {
        Cache::forget(self::CACHE_KEY);
    }

    /**
     * Matches per rule from $since (a Berlin calendar day, Y-m-d) on, for ADM-23.
     *
     * @return array<int, int> rule id => hits
     */
    public function hitsSince(string $since): array
    {
        return DB::table('keyword_rule_hits')->where('day', '>=', $since)->groupBy('keyword_rule_id')->selectRaw('keyword_rule_id, sum(hits) as hits')
            ->pluck('hits', 'keyword_rule_id')->map(fn (mixed $hits): int => (int) $hits)->all();
    }

    /**
     * The rules of $list that $text contains.
     *
     * @return list<array{id: int, term: string, list: string}>
     */
    public function match(?string $text, KeywordList $list): array
    {
        if ($text === null || trim($text) === '') {
            return [];
        }

        $rules = array_values(array_filter($this->all(), fn (array $rule): bool => $rule['list'] === $list->value));

        if ($rules === []) {
            return [];
        }

        $forms = KeywordNormaliser::textForms($text);

        return array_values(array_filter($rules, fn (array $rule): bool => KeywordNormaliser::matches($forms, $rule['term'])));
    }

    /**
     * @param  list<array{id: int, term: string, list: string}>  $rules
     */
    public function count(array $rules, KeywordField $field): void
    {
        if ($rules === []) {
            return;
        }

        $day = now()->setTimezone(config()->string('speedclub.display_timezone'))->toDateString();

        try {
            foreach ($rules as $rule) {
                DB::table('keyword_rule_hits')->insertOrIgnore(['keyword_rule_id' => $rule['id'], 'day' => $day, 'field' => $field->value, 'hits' => 0]);
                DB::table('keyword_rule_hits')->where(['keyword_rule_id' => $rule['id'], 'day' => $day, 'field' => $field->value])->increment('hits');
            }
        } catch (Throwable $exception) {
            report($exception);
        }
    }
}
