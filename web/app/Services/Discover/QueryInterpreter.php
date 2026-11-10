<?php

namespace App\Services\Discover;

use App\Services\Search\SearchTerms;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Query understanding for DISC-02 (m2.3 contract §3, 05_ARCHITECTURE §10): what a typed query names in the catalogue and in a few
 * fixed patterns, as filters the app shows as removable chips. It only reads the catalogue (makes, models, generations) and never
 * applies anything itself; the words it does not use stay in remaining_q, which the app searches as text.
 *
 * Rules, in this order:
 * 1. Patterns. "19 zoll", "19zoll", `19"`, "19″", "19,5 zoll" → wheel_diameter (13–24 in half inches). "500 ps", "500ps" → power_min
 *    (50–1500).
 * 2. Makes: a word or up to three words joined ("mercedes benz") equal to a make's name or slug, or an alias of
 *    speedclub.search.make_aliases ("vw"). A second, different make stays text.
 * 3. Models: words equal to a model's whole name ("m4", "golf gti", "gt-r"), of the make when one is named. A pure year
 *    ("2008") counts as a model only next to its make.
 * 4. Generations: a word equal to a generation's name or one of its parts ("g82"; "e92" of "E90/E92/E93"; "5g" of "VII (5G)"), of the
 *    named model, else of the named make.
 * 5. Ambiguity: a model or generation that fits more than one entry is no chip. When all of them belong to one make, the make becomes
 *    the chip and the word stays text, so the text finds them all: "e46" → BMW + "e46" (3er and M3), "golf" → Volkswagen + "golf" (Golf,
 *    Golf GTI, Golf R), "gtr" → Nissan + "gtr" (GT-R and Skyline GT-R). Across makes it is only text: "gt". A model name that is also a
 *    word of another model of its make counts as ambiguous in the same way, so a chip never hides the bigger family.
 * 6. Years: a four-digit year from 1950 to this year, left over → year_min = year_max.
 *
 * Only active makes, active models of active makes and the active generations of those are read (M2.3 review #7); the names of
 * entries merged into one of them (M3.3) name the survivor. The catalogue becomes plain
 * array indices, cached under a stamp of the three tables (rows and a checksum of the columns read), so a request reads one stamp instead of the
 * whole catalogue and any admin edit builds new indices (review #8). Words past the 12-token cap are not interpreted but stay in
 * remaining_q (review #19).
 *
 * @phpstan-type MakeRow array{name: string, slug: string}
 * @phpstan-type ModelRow array{make_id: int, name: string, slug: string, words: list<string>}
 * @phpstan-type GenerationRow array{model_id: int, name: string, slug: string}
 * @phpstan-type Catalogue array{makes: array<int, MakeRow>, make_index: array<string, list<int>>, models: array<int, ModelRow>, model_index: array<string, list<int>>, generations: array<int, GenerationRow>, generation_index: array<string, list<int>>}
 */
final class QueryInterpreter
{
    /** Up to this many words make one name ("Corolla Levin Trueno"). */
    private const MAX_SPAN = 3;

    private const FIRST_YEAR = 1950;

    /** Words looked at; the rest go to remaining_q as typed. */
    private const MAX_TOKENS = 12;

    /** Part of the cache key: raising it rebuilds the indices after a change to their shape. */
    private const INDEX_VERSION = 2;

    private const CACHE_SECONDS = 86400;

    /** @var Catalogue|null */
    private ?array $catalogue = null;

    public function interpret(string $query): Interpretation
    {
        [$tokens, $overflow] = $this->tokens($query);
        $used = array_fill(0, count($tokens), false);
        $chips = [];
        $filters = [];
        $catalogue = $this->catalogue();

        $this->patterns($tokens, $used, $filters, $chips);

        // 2. Makes.
        $make = null;

        foreach ($this->spans($tokens, $used) as [$from, $length, $key]) {
            $candidates = $catalogue['make_index'][$key] ?? [];

            if (count($candidates) === 1 && ($make === null || $make === $candidates[0])) {
                $make = $candidates[0];
                $this->use($used, $from, $length);
                $chips['make'] = $this->chip('make', $catalogue['makes'][$make], $tokens, $from, $length);
            }
        }

        // 3. Models.
        $model = null;
        $familyMakes = [];
        $pendingModels = [];

        foreach ($this->spans($tokens, $used) as [$from, $length, $key]) {
            if ($model !== null || ($make === null && $this->isYear($key))) {
                continue;
            }

            $candidates = array_values(array_filter(
                $catalogue['model_index'][$key] ?? [],
                fn (int $candidate): bool => $make === null || $catalogue['models'][$candidate]['make_id'] === $make,
            ));

            if ($candidates === []) {
                continue;
            }

            if (count($candidates) === 1 && ! $this->isFamily($candidates[0], $key)) {
                $model = $candidates[0];
                $this->use($used, $from, $length);
                $chips['model'] = $this->chip('model', $catalogue['models'][$model], $tokens, $from, $length);

                continue;
            }

            // Several models of that name (across makes) can still be told apart by a generation; a family cannot (rule 5).
            if (count($candidates) > 1) {
                $pendingModels[] = $candidates;
            }

            $familyMakes[] = array_map(fn (int $candidate): int => $catalogue['models'][$candidate]['make_id'], $candidates);
        }

        // 4. Generations, which can also settle a model that was ambiguous on its own.
        $generation = null;
        $pending = array_merge([], ...$pendingModels);

        foreach ($this->spans($tokens, $used, 1) as [$from, $length, $key]) {
            if ($generation !== null || $this->isYear($key)) {
                continue;
            }

            $candidates = array_values(array_filter($catalogue['generation_index'][$key] ?? [], function (int $candidate) use ($catalogue, $model, $make, $pending): bool {
                $candidateModel = $catalogue['generations'][$candidate]['model_id'];

                if ($model !== null) {
                    return $candidateModel === $model;
                }

                if ($pending !== []) {
                    return in_array($candidateModel, $pending, true);
                }

                return $make === null || $catalogue['models'][$candidateModel]['make_id'] === $make;
            }));

            if (count($candidates) === 1) {
                $generation = $candidates[0];
                $this->use($used, $from, $length);
                $chips['generation'] = $this->chip('generation', $catalogue['generations'][$generation], $tokens, $from, $length);

                if ($model === null) {
                    $model = $catalogue['generations'][$generation]['model_id'];
                    $this->useModelSpan($tokens, $used, $model, $chips);
                    $chips['model'] ??= $this->chip('model', $catalogue['models'][$model], [], 0, 0);
                }
            } elseif ($candidates !== []) {
                $familyMakes[] = array_map(fn (int $candidate): int => $catalogue['models'][$catalogue['generations'][$candidate]['model_id']]['make_id'], $candidates);
            }
        }

        // 5. A make the model or generation implies, or that every reading of an ambiguous word shares.
        if ($make === null && $model !== null) {
            $make = $catalogue['models'][$model]['make_id'];
        }

        if ($make === null) {
            $shared = array_values(array_unique(array_merge([], ...$familyMakes)));

            if (count($shared) === 1) {
                $make = $shared[0];
            }
        }

        if ($make !== null) {
            $chips['make'] ??= $this->chip('make', $catalogue['makes'][$make], [], 0, 0);
            $filters['make'] = $catalogue['makes'][$make]['slug'];
        }

        if ($model !== null) {
            $filters['model'] = $catalogue['models'][$model]['slug'];
        }

        if ($generation !== null) {
            $filters['generation'] = $catalogue['generations'][$generation]['slug'];
        }

        // 6. Years.
        foreach ($tokens as $index => $token) {
            if (! $used[$index] && ! isset($filters['year_min']) && $this->isYear($token['key'])) {
                $year = (int) $token['key'];
                $used[$index] = true;
                $filters['year_min'] = $year;
                $filters['year_max'] = $year;
                $chips['year'] = new InterpretationChip('year', "$year-$year", (string) $year, $token['raw']);
            }
        }

        $remaining = [];

        foreach ($tokens as $index => $token) {
            if (! $used[$index]) {
                $remaining[] = $token['raw'];
            }
        }

        $order = ['make', 'model', 'generation', 'year', 'power', 'wheel_diameter'];
        $sorted = array_values(array_filter(array_map(fn (string $field): ?InterpretationChip => $chips[$field] ?? null, $order)));

        return new Interpretation($this->orderedFilters($filters), $sorted, implode(' ', [...$remaining, ...$overflow]));
    }

    /**
     * The first MAX_TOKENS words to interpret, and the raw words after them.
     *
     * @return array{0: list<array{raw: string, key: string}>, 1: list<string>}
     */
    private function tokens(string $query): array
    {
        $tokens = [];
        $words = preg_split('/[\s;]+|(?<!\d),|,(?!\d)/u', mb_substr($query, 0, 1000), -1, PREG_SPLIT_NO_EMPTY) ?: [];

        foreach (array_slice($words, 0, self::MAX_TOKENS) as $raw) {
            $tokens[] = ['raw' => $raw, 'key' => SearchTerms::word($raw)];
        }

        return [$tokens, array_slice($words, self::MAX_TOKENS)];
    }

    /**
     * Wheel diameters and power.
     *
     * @param  list<array{raw: string, key: string}>  $tokens
     * @param  array<int, bool>  $used
     * @param  array<string, mixed>  $filters
     * @param  array<string, InterpretationChip>  $chips
     */
    private function patterns(array $tokens, array &$used, array &$filters, array &$chips): void
    {
        $de = app()->getLocale() === 'de';
        $inch = '(?:zoll|"|″|”|\'\'|inch|in)';

        foreach ($tokens as $index => $token) {
            if ($used[$index]) {
                continue;
            }

            $raw = mb_strtolower($token['raw']);
            $next = isset($tokens[$index + 1]) && ! $used[$index + 1] ? mb_strtolower($tokens[$index + 1]['raw']) : null;
            $length = 0;
            $number = null;

            if (preg_match('/^(\d{2}(?:[.,]5)?)'.$inch.'$/u', $raw, $match) === 1) {
                [$number, $length] = [$match[1], 1];
            } elseif ($next !== null && preg_match('/^\d{2}(?:[.,]5)?$/', $raw) === 1 && preg_match('/^'.$inch.'$/u', $next) === 1) {
                [$number, $length] = [$raw, 2];
            }

            if ($number !== null && ! isset($filters['wheel_diameter'])) {
                $inches = (float) str_replace(',', '.', $number);

                if ($inches >= 13 && $inches <= 24) {
                    $value = SearchFilterResolver::diameter($inches);
                    $filters['wheel_diameter'] = [(float) $value];
                    $this->use($used, $index, $length);
                    $label = ($de ? str_replace('.', ',', $value) : $value).'″';
                    $chips['wheel_diameter'] = new InterpretationChip('wheel_diameter', $value, $label, $this->text($tokens, $index, $length));

                    continue;
                }
            }

            $power = null;

            if (preg_match('/^(\d{2,4})ps$/', $raw, $match) === 1) {
                [$power, $length] = [(int) $match[1], 1];
            } elseif ($next === 'ps' && preg_match('/^\d{2,4}$/', $raw) === 1) {
                [$power, $length] = [(int) $raw, 2];
            }

            if ($power !== null && $power >= 50 && $power <= 1500 && ! isset($filters['power_min'])) {
                $filters['power_min'] = $power;
                $this->use($used, $index, $length);
                $chips['power'] = new InterpretationChip('power', "$power-", (string) __('discover.interpret.power_min', ['power' => $power]), $this->text($tokens, $index, $length));
            }
        }
    }

    /**
     * Free runs of words, the longest first at each place, as [from, length, joined key].
     *
     * @param  list<array{raw: string, key: string}>  $tokens
     * @param  array<int, bool>  $used
     * @return iterable<array{0: int, 1: int, 2: string}>
     */
    private function spans(array $tokens, array &$used, int $maxSpan = self::MAX_SPAN): iterable
    {
        for ($from = 0; $from < count($tokens); $from++) {
            for ($length = min($maxSpan, count($tokens) - $from); $length >= 1; $length--) {
                $free = true;
                $key = '';

                for ($i = $from; $i < $from + $length; $i++) {
                    $free = $free && ! $used[$i];
                    $key .= $tokens[$i]['key'];
                }

                if ($free && $key !== '') {
                    yield [$from, $length, $key];

                    // The caller took the span: go on after it.
                    if ($used[$from]) {
                        $from += $length - 1;

                        break;
                    }
                }
            }
        }
    }

    /**
     * Another model of the same make has this word in its name ("golf" in "Golf GTI", "gtr" in "Skyline GT-R").
     */
    private function isFamily(int $model, string $key): bool
    {
        $models = $this->catalogue()['models'];

        foreach ($models as $id => $row) {
            if ($id !== $model && $row['make_id'] === $models[$model]['make_id'] && in_array($key, $row['words'], true)) {
                return true;
            }
        }

        return false;
    }

    /**
     * After a generation settled an ambiguous model, the model's own word is used too.
     *
     * @param  list<array{raw: string, key: string}>  $tokens
     * @param  array<int, bool>  $used
     * @param  array<string, InterpretationChip>  $chips
     */
    private function useModelSpan(array $tokens, array &$used, int $model, array &$chips): void
    {
        $row = $this->catalogue()['models'][$model];

        foreach ($this->spans($tokens, $used) as [$from, $length, $key]) {
            if (in_array($key, $row['words'], true)) {
                $this->use($used, $from, $length);
                $chips['model'] = $this->chip('model', $row, $tokens, $from, $length);

                return;
            }
        }
    }

    private function isYear(string $key): bool
    {
        return preg_match('/^\d{4}$/', $key) === 1 && (int) $key >= self::FIRST_YEAR && (int) $key <= (int) now()->format('Y');
    }

    /**
     * @param  array<int, bool>  $used
     */
    private function use(array &$used, int $from, int $length): void
    {
        for ($i = $from; $i < $from + $length; $i++) {
            $used[$i] = true;
        }
    }

    /**
     * @param  array{name: string, slug: string}  $row
     * @param  list<array{raw: string, key: string}>  $tokens
     */
    private function chip(string $field, array $row, array $tokens, int $from, int $length): InterpretationChip
    {
        return new InterpretationChip($field, $row['slug'], $row['name'], $length === 0 ? null : $this->text($tokens, $from, $length));
    }

    /**
     * @param  list<array{raw: string, key: string}>  $tokens
     */
    private function text(array $tokens, int $from, int $length): string
    {
        return implode(' ', array_map(fn (array $token): string => $token['raw'], array_slice($tokens, $from, $length)));
    }

    /**
     * @param  array<string, mixed>  $filters
     * @return array<string, mixed>
     */
    private function orderedFilters(array $filters): array
    {
        $order = ['make', 'model', 'generation', 'year_min', 'year_max', 'power_min', 'wheel_diameter'];

        return array_filter(array_replace(array_fill_keys($order, null), $filters), fn (mixed $value): bool => $value !== null);
    }

    /**
     * The indices, once per instance: from the cache while the stamp of the catalogue is the same, else built and stored under the new
     * stamp. The aliases are part of the key, as they come from the config.
     *
     * @return Catalogue
     */
    private function catalogue(): array
    {
        if ($this->catalogue === null) {
            /** @var array<string, string> $aliases */
            $aliases = config('speedclub.search.make_aliases', []);
            $key = 'discover:interpret:'.hash('sha256', (string) json_encode([self::INDEX_VERSION, $this->stamp(), $aliases]));

            /** @var Catalogue $catalogue */
            $catalogue = Cache::remember($key, self::CACHE_SECONDS, fn (): array => $this->build($aliases));
            $this->catalogue = $catalogue;
        }

        return $this->catalogue;
    }

    /**
     * One query: rows and a checksum of what the indices read, per table. A rename, a merge, a new entry or one switched off changes it,
     * also within the second of the last edit, which a stamp of updated_at would miss. A few thousand short rows, aggregated in the
     * database.
     *
     * @return list<mixed>
     */
    private function stamp(): array
    {
        $row = DB::query()->selectRaw(
            "(SELECT CONCAT(COUNT(*), ':', COALESCE(SUM(CRC32(CONCAT_WS('|', id, name, slug, active, COALESCE(merged_into_id, 0)))), 0)) FROM makes) AS makes, "
            ."(SELECT CONCAT(COUNT(*), ':', COALESCE(SUM(CRC32(CONCAT_WS('|', id, make_id, name, slug, active, COALESCE(merged_into_id, 0)))), 0)) FROM vehicle_models) AS models, "
            ."(SELECT CONCAT(COUNT(*), ':', COALESCE(SUM(CRC32(CONCAT_WS('|', id, model_id, name, slug, active, COALESCE(merged_into_id, 0)))), 0)) FROM generations) AS generations"
        )->first();

        return array_values((array) $row);
    }

    /**
     * @param  array<string, string>  $aliases
     * @return Catalogue
     */
    private function build(array $aliases): array
    {
        $makes = [];
        $makeIndex = [];
        $bySlug = [];

        // One read for both: the active makes, and the merged ones (M3.3), whose name and slug name their survivor.
        $rows = DB::table('makes')->where(fn ($query) => $query->where('active', true)->orWhereNotNull('merged_into_id'))->orderBy('id')->get(['id', 'name', 'slug', 'active', 'merged_into_id']);

        foreach ($rows->where('merged_into_id', null)->filter(fn (object $make): bool => (bool) $make->active) as $make) {
            $id = (int) $make->id;
            $makes[$id] = ['name' => (string) $make->name, 'slug' => (string) $make->slug];
            $bySlug[(string) $make->slug] = $id;

            foreach ([SearchTerms::word((string) $make->name), SearchTerms::word((string) $make->slug)] as $key) {
                $this->add($makeIndex, $key, $id);
            }
        }

        foreach ($aliases as $alias => $slug) {
            if (isset($bySlug[$slug])) {
                $this->add($makeIndex, SearchTerms::word($alias), $bySlug[$slug]);
            }
        }

        foreach ($rows->whereNotNull('merged_into_id') as $merged) {
            if (isset($makes[(int) $merged->merged_into_id])) {
                foreach ([SearchTerms::word((string) $merged->name), SearchTerms::word((string) $merged->slug)] as $key) {
                    $this->add($makeIndex, $key, (int) $merged->merged_into_id);
                }
            }
        }

        $models = [];
        $modelIndex = [];

        $rows = DB::table('vehicle_models')
            ->where(fn ($query) => $query->where(fn ($live) => $live->where('active', true)->whereIn('make_id', array_keys($makes) ?: [0]))->orWhereNotNull('merged_into_id'))
            ->orderBy('id')
            ->get(['id', 'make_id', 'name', 'slug', 'merged_into_id']);

        foreach ($rows->where('merged_into_id', null) as $model) {
            $id = (int) $model->id;
            $name = (string) $model->name;
            $models[$id] = ['make_id' => (int) $model->make_id, 'name' => $name, 'slug' => (string) $model->slug, 'words' => SearchTerms::phraseWords($name)];
            $this->add($modelIndex, SearchTerms::word(str_replace(' ', '', $name)), $id);
        }

        foreach ($rows->whereNotNull('merged_into_id') as $merged) {
            if (isset($models[(int) $merged->merged_into_id])) {
                $this->add($modelIndex, SearchTerms::word(str_replace(' ', '', (string) $merged->name)), (int) $merged->merged_into_id);
            }
        }

        $generations = [];
        $generationIndex = [];

        foreach (DB::table('generations')->where('active', true)->whereIn('model_id', array_keys($models) ?: [0])->orderBy('id')->get(['id', 'model_id', 'name', 'slug']) as $generation) {
            $id = (int) $generation->id;
            $generations[$id] = ['model_id' => (int) $generation->model_id, 'name' => (string) $generation->name, 'slug' => (string) $generation->slug];

            foreach (SearchTerms::phraseWords((string) $generation->name) as $word) {
                // "1. Generation" and "Typ 1" name no generation by their number alone.
                if (preg_match('/^\d$/', $word) !== 1 && $word !== 'generation' && $word !== 'typ') {
                    $this->add($generationIndex, $word, $id);
                }
            }
        }

        return [
            'makes' => $makes,
            'make_index' => $makeIndex,
            'models' => $models,
            'model_index' => $modelIndex,
            'generations' => $generations,
            'generation_index' => $generationIndex,
        ];
    }

    /**
     * @param  array<string, list<int>>  $index
     */
    private function add(array &$index, string $key, int $id): void
    {
        if ($key !== '' && ! in_array($id, $index[$key] ?? [], true)) {
            $index[$key][] = $id;
        }
    }
}
