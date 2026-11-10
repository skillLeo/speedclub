<?php

use App\Http\RateLimits;
use App\Models\Make;
use App\Models\VehicleModel;
use App\Services\Discover\QueryInterpreter;
use Database\Seeders\CatalogSeeder;
use Illuminate\Support\Facades\DB;

/**
 * M2.3 GET search/interpret (m2.3 contract §3): catalogue-only query understanding against the real catalogue
 * (database/data/catalog.json), with its ambiguities.
 */
beforeEach(function () {
    $this->seed(CatalogSeeder::class);
    app()->setLocale('de');
});

/**
 * @return array{filters: array<string, mixed>, chips: list<string>, remaining: string}
 */
function m23Understand(string $query): array
{
    $result = app(QueryInterpreter::class)->interpret($query);

    return [
        'filters' => $result->filters,
        'chips' => array_map(fn ($chip): string => $chip->field.':'.$chip->label, $result->chips),
        'remaining' => $result->remainingQ,
    ];
}

it('understands real catalogue examples', function (string $query, array $filters, array $chips, string $remaining) {
    expect(m23Understand($query))->toBe(['filters' => $filters, 'chips' => $chips, 'remaining' => $remaining]);
})->with([
    'a model names its make' => ['m4', ['make' => 'bmw', 'model' => 'm4'], ['make:BMW', 'model:M4'], ''],
    'a generation names model and make' => ['g82', ['make' => 'bmw', 'model' => 'm4', 'generation' => 'g82'], ['make:BMW', 'model:M4', 'generation:G82'], ''],
    'generation and model together' => ['e46 m3', ['make' => 'bmw', 'model' => 'm3', 'generation' => 'e46'], ['make:BMW', 'model:M3', 'generation:E46'], ''],
    'a part of a generation name' => ['e92', ['make' => 'bmw'], ['make:BMW'], 'e92'],
    'r34' => ['r34', ['make' => 'nissan', 'model' => 'skyline-gt-r', 'generation' => 'r34'], ['make:Nissan', 'model:Skyline GT-R', 'generation:R34'], ''],
    'model words are used with their generation' => ['skyline r34', ['make' => 'nissan', 'model' => 'skyline-gt-r', 'generation' => 'r34'], ['make:Nissan', 'model:Skyline GT-R', 'generation:R34'], ''],
    'a two-word model and a generation part in brackets' => ['golf gti 5g', ['make' => 'volkswagen', 'model' => 'golf-gti', 'generation' => 'vii-5g'], ['make:Volkswagen', 'model:Golf GTI', 'generation:VII (5G)'], ''],
    'a hyphenated make' => ['mercedes-benz', ['make' => 'mercedes-benz'], ['make:Mercedes-Benz'], ''],
    // W204 is a C-Klasse and a C 63 AMG: the make is certain, the generation stays text.
    'two words for one make' => ['mercedes benz w204', ['make' => 'mercedes-benz'], ['make:Mercedes-Benz'], 'w204'],
    'a model settles the generation' => ['c 63 amg w204', ['make' => 'mercedes-benz', 'model' => 'c-63-amg', 'generation' => 'w204'], ['make:Mercedes-Benz', 'model:C 63 AMG', 'generation:W204'], ''],
    'an alias of the configuration' => ['vw scirocco', ['make' => 'volkswagen', 'model' => 'scirocco'], ['make:Volkswagen', 'model:Scirocco'], ''],
    'wheel size with Zoll' => ['19 zoll', ['wheel_diameter' => [19.0]], ['wheel_diameter:19″'], ''],
    'wheel size with a quote' => ['19"', ['wheel_diameter' => [19.0]], ['wheel_diameter:19″'], ''],
    'half inch, German comma' => ['19,5zoll', ['wheel_diameter' => [19.5]], ['wheel_diameter:19,5″'], ''],
    'power' => ['500 ps', ['power_min' => 500], ['power:ab 500 PS'], ''],
    'power in one word' => ['500PS', ['power_min' => 500], ['power:ab 500 PS'], ''],
    'a year' => ['2004', ['year_min' => 2004, 'year_max' => 2004], ['year:2004'], ''],
    'everything at once, rest as text' => ['bmw m4 19 zoll 500 ps carbon', ['make' => 'bmw', 'model' => 'm4', 'power_min' => 500, 'wheel_diameter' => [19.0]], ['make:BMW', 'model:M4', 'power:ab 500 PS', 'wheel_diameter:19″'], 'carbon'],
    'Porsche by its numbers' => ['911 964', ['make' => 'porsche', 'model' => '911', 'generation' => '964'], ['make:Porsche', 'model:911', 'generation:964'], ''],
]);

it('resolves ambiguity explainably', function (string $query, array $filters, string $remaining) {
    $understood = m23Understand($query);

    expect($understood['filters'])->toBe($filters)->and($understood['remaining'])->toBe($remaining);
})->with([
    // "Golf" is a model, and also the start of Golf GTI and Golf R: the make is certain, the model is not.
    'golf is a model of a family' => ['golf', ['make' => 'volkswagen'], 'golf'],
    'golf with the make' => ['vw golf', ['make' => 'volkswagen'], 'golf'],
    // GT is a model of Ford and others: nothing is certain.
    'gt stays text' => ['gt', [], 'gt'],
    // GT-R and Skyline GT-R are both Nissans.
    'gtr names a make' => ['gtr', ['make' => 'nissan'], 'gtr'],
    'GT-R in any spelling' => ['GT-R', ['make' => 'nissan'], 'GT-R'],
    // E46 is a 3er and an M3.
    'e46 names a make' => ['e46', ['make' => 'bmw'], 'e46'],
    'a model of another make stays text' => ['bmw golf', ['make' => 'bmw'], 'golf'],
    'a second make stays text' => ['bmw audi', ['make' => 'bmw'], 'audi'],
    'a year beyond this one is text' => ['2099', [], '2099'],
    'before 1950 is text' => ['1949', [], '1949'],
    'a wheel size off the schema is text' => ['30 zoll', [], '30 zoll'],
    'power below 50 is text' => ['20 ps', [], '20 ps'],
    'words nobody knows' => ['schwarz matt', [], 'schwarz matt'],
]);

it('answers through the API with chips the app can remove', function () {
    $this->withHeader('Accept-Language', 'de')->getJson('/api/v1/search/interpret?q='.urlencode('E46 M3 18" Mattschwarz'))->assertOk()
        ->assertJsonPath('data.filters', ['make' => 'bmw', 'model' => 'm3', 'generation' => 'e46', 'wheel_diameter' => [18]])
        ->assertJsonPath('data.chips.0', ['field' => 'make', 'value' => 'bmw', 'label' => 'BMW', 'matched' => null])
        ->assertJsonPath('data.chips.1', ['field' => 'model', 'value' => 'm3', 'label' => 'M3', 'matched' => 'M3'])
        ->assertJsonPath('data.chips.2', ['field' => 'generation', 'value' => 'e46', 'label' => 'E46', 'matched' => 'E46'])
        ->assertJsonPath('data.chips.3', ['field' => 'wheel_diameter', 'value' => '18', 'label' => '18″', 'matched' => '18"'])
        ->assertJsonPath('data.remaining_q', 'Mattschwarz');

    $this->withHeader('Accept-Language', 'en')->getJson('/api/v1/search/interpret?q=500ps+2001')->assertOk()
        ->assertJsonPath('data.chips.0', ['field' => 'year', 'value' => '2001-2001', 'label' => '2001', 'matched' => '2001'])
        ->assertJsonPath('data.chips.1', ['field' => 'power', 'value' => '500-', 'label' => 'from 500 PS', 'matched' => '500ps']);

    $this->getJson('/api/v1/search/interpret?q=xyz')->assertOk()->assertJsonPath('data.filters', [])->assertJsonPath('data.chips', []);
});

it('applies the understood filters as they are, so the app gets the same results as through search/vehicles', function () {
    $understood = $this->getJson('/api/v1/search/interpret?q='.urlencode('bmw m4 g82 19 zoll'))->assertOk()->json('data.filters');

    $this->getJson('/api/v1/search/vehicles?'.http_build_query($understood))->assertOk();
});

it('never reads a deactivated catalogue entry', function () {
    VehicleModel::query()->where('slug', 'm4')->update(['active' => false]);
    Make::query()->where('slug', 'audi')->update(['active' => false]);

    expect(m23Understand('m4')['filters'])->toBe([])
        ->and(m23Understand('audi')['filters'])->toBe([])
        // M2.3 review #7: nor a generation of a model or make that is switched off.
        ->and(m23Understand('g82')['filters'])->toBe([])
        ->and(m23Understand('g82')['remaining'])->toBe('g82');

    Make::query()->where('slug', 'nissan')->update(['active' => false]);

    expect(m23Understand('r34')['filters'])->toBe([])
        ->and(m23Understand('skyline gt-r')['filters'])->toBe([]);
});

it('keeps the words past the 12-word cap in remaining_q (M2.3 review #19)', function () {
    $words = implode(' ', array_fill(0, 12, 'qqq'));

    expect(m23Understand($words.' m4 g82')['remaining'])->toBe($words.' m4 g82')
        ->and(m23Understand($words.' m4 g82')['filters'])->toBe([]);
});

it('caches the catalogue indices and builds them again after any catalogue edit (M2.3 review #8)', function () {
    $count = function (string $query): int {
        DB::flushQueryLog();
        DB::enableQueryLog();
        (new QueryInterpreter)->interpret($query);
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $queries;
    };

    expect($count('bmw m4 g82'))->toBeGreaterThan(1)
        ->and($count('bmw m4 g82'))->toBe(1)
        ->and(m23Understand('g82')['filters'])->toBe(['make' => 'bmw', 'model' => 'm4', 'generation' => 'g82']);

    VehicleModel::query()->where('slug', 'm4')->update(['name' => 'M4 Coupé']);

    expect($count('bmw m4 g82'))->toBeGreaterThan(1)
        ->and(m23Understand('m4 coupé')['filters'])->toMatchArray(['make' => 'bmw', 'model' => 'm4']);
});

it('validates the query', function (string $query) {
    $this->withHeader('Accept-Language', 'de')->getJson('/api/v1/search/interpret'.$query)->assertUnprocessable()->assertJsonValidationErrors('q');
})->with(['', '?q=', '?q=%21%21', '?q='.str_repeat('a', 101)]);

it('counts against the search limit', function () {
    config(['speedclub.rate_limits.search.max' => 2]);
    app(RateLimits::class)->register();

    $this->getJson('/api/v1/search/interpret?q=m4')->assertOk();
    $this->getJson('/api/v1/search/interpret?q=m4')->assertOk();
    $this->getJson('/api/v1/search/interpret?q=m4')->assertStatus(429)->assertJsonPath('code', 'rate_limited');
});

it('reads the catalogue in a fixed number of queries, whatever the query', function () {
    $count = function (string $query): int {
        $interpreter = new QueryInterpreter;
        DB::flushQueryLog();
        DB::enableQueryLog();
        $interpreter->interpret($query);
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        return $queries;
    };

    expect($count('a b c d e f g h i j k l m n'))->toBeLessThanOrEqual($count('m4') + 3)
        ->and($count('e46'))->toBeLessThanOrEqual(8);
});
