<?php

/**
 * M2.3 in the export: bracketed list parameters typed as arrays (openapi-fetch sends arrays as repeated `key[]`), and typed item
 * schemas for every new shape, so the mobile types need nothing written by hand.
 */
function m23OpenApi(): array
{
    $path = tempnam(sys_get_temp_dir(), 'openapi');
    test()->artisan('scramble:export', ['--path' => $path])->assertSuccessful();
    $document = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    unlink($path);

    return $document;
}

it('documents the list filters as bracketed arrays on every search route', function () {
    $document = m23OpenApi();
    $lists = ['drivetrain', 'gearbox', 'fuel', 'wheel_diameter', 'wheel_brand', 'suspension_type', 'suspension_brand', 'exhaust_brand', 'mod_category'];

    foreach (['/search', '/search/vehicles', '/search/facets'] as $path) {
        $parameters = collect($document['paths'][$path]['get']['parameters'])->keyBy('name');

        foreach ($lists as $list) {
            expect($parameters->get($list.'[]')['schema']['type'] ?? null)->toBe('array', "$path $list")
                ->and($parameters->has($list))->toBeFalse();
        }

        expect($parameters->get('wheel_diameter[]')['schema']['items']['type'])->toBe('number')
            ->and($parameters->get('drivetrain[]')['schema']['items'])->toBe(['$ref' => '#/components/schemas/Drivetrain'])
            ->and($parameters->keys()->all())->toContain('make', 'model', 'generation', 'year_min', 'year_max', 'power_min', 'power_max');
    }

    $vehicles = collect($document['paths']['/search/vehicles']['get']['parameters'])->keyBy('name');
    expect($vehicles->get('q')['required'] ?? false)->toBeFalse()
        ->and($vehicles->get('sort')['schema']['anyOf'][0])->toBe(['$ref' => '#/components/schemas/SearchSort']);
});

it('documents the M2.3 routes with typed resources', function () {
    $document = m23OpenApi();
    $schemas = $document['components']['schemas'];
    $ref = fn (string $name) => ['$ref' => '#/components/schemas/'.$name];
    $data = fn (string $path) => $document['paths'][$path]['get']['responses'][200]['content']['application/json']['schema']['properties']['data'];

    expect($data('/search/facets'))->toBe($ref('FacetsResource'))
        ->and($schemas['FacetsResource']['properties']['makes']['items'])->toBe($ref('FacetResource'))
        ->and($schemas['FacetsResource']['properties']['models']['type'])->toBe(['array', 'null'])
        ->and(array_keys($schemas['FacetResource']['properties']))->toBe(['value', 'label', 'count'])
        ->and($schemas['FacetsResource']['properties']['year']['properties'])->toHaveKeys(['min', 'max'])
        ->and($data('/search/interpret'))->toBe($ref('InterpretationResource'))
        ->and($schemas['InterpretationResource']['properties']['chips']['items'])->toBe($ref('InterpretationChipResource'))
        ->and($schemas['InterpretationResource']['properties']['filters']['properties']['wheel_diameter']['type'])->toBe('array')
        ->and($data('/discover'))->toBe($ref('DiscoverResource'))
        ->and($schemas['DiscoverResource']['properties']['collections']['items'])->toBe($ref('CollectionResource'))
        ->and($schemas['DiscoverResource']['properties']['popular_mods']['items'])->toBe($ref('PopularModResource'))
        ->and($schemas['DiscoverResource']['properties']['similar_members']['items'])->toBe($ref('MemberSearchResource'))
        ->and($schemas['CollectionResource']['properties']['filters']['properties'])->toHaveKeys(['make', 'model', 'wheel_diameter', 'mod_category'])
        ->and($data('/discover/makes/{make}'))->toBe($ref('MakePageResource'))
        ->and($schemas['MakePageResource']['properties']['models']['items'])->toBe($ref('ModelCountResource'))
        ->and($schemas['ModelCountResource']['properties']['generations']['items'])->toBe($ref('GenerationCountResource'))
        ->and($data('/discover/models/{model}'))->toBe($ref('ModelPageResource'))
        ->and($schemas['ModelPageResource']['properties']['model'])->toBe($ref('ModelSummaryResource'))
        ->and($data('/discover/models/{model}/wheel-setups')['items'])->toBe($ref('WheelSetupResource'))
        ->and($data('/discover/models/{model}/builds')['items'])->toBe($ref('FeedVehicleResource'))
        ->and($data('/vehicles/{id}/similar')['items'])->toBe($ref('FeedVehicleResource'))
        ->and($schemas['WheelSetupResource']['properties'])->toHaveKeys(['vehicle', 'wheel', 'suspension'])
        ->and($schemas['ModificationResource']['properties']['search']['required'])->toContain('mod_category', 'wheel_diameter')
        ->and($document['paths']['/vehicles/{id}/similar']['get']['security'])->toBe([])
        ->and(collect($document['paths']['/discover/models/{model}/wheel-setups']['get']['parameters'])->pluck('name')->all())->not->toContain('sort');
});
