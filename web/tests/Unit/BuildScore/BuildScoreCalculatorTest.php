<?php

use App\Services\BuildScore\BuildScoreCalculator;
use App\Services\BuildScore\BuildScoreFacts;

/**
 * M5.9c (owner gift detail M5.9c, m5.9c contract §3): every item of the formula, every cap, the parts, the stages and "Nächstes Upgrade".
 * Pure: facts in, points out.
 */
function calc(): BuildScoreCalculator
{
    return new BuildScoreCalculator;
}

/** @param array<string, mixed> $facts */
function scoreOf(array $facts): array
{
    return calc()->calculate(new BuildScoreFacts(...$facts));
}

it('adds up to 1000 with the owner-approved parts 300 / 300 / 250 / 150', function () {
    $parts = collect(calc()->parts())->mapWithKeys(fn (array $part): array => [$part['key'] => $part['max']])->all();

    expect($parts)->toBe(['completeness' => 300, 'documentation' => 300, 'community' => 250, 'journey' => 150])
        ->and(array_sum($parts))->toBe(1000)
        ->and(calc()->max())->toBe(1000);
});

it('gives each item its points per unit up to its cap', function (string $item, array $facts, int $points) {
    $result = scoreOf($facts);

    expect($result['breakdown'][$item]['points'])->toBe($points)
        ->and($result['total'])->toBe($points);
})->with([
    'photos 20 each' => ['photos', ['photos' => 2], 40],
    'photos capped at 6 (120)' => ['photos', ['photos' => 9], 120],
    'key specs 10 each' => ['key_specs', ['keySpecs' => 4], 40],
    'key specs capped at 10 (100)' => ['key_specs', ['keySpecs' => 14], 100],
    'description under 200 chars: nothing' => ['description', ['descriptionChars' => 199], 0],
    'description from 200 chars: 50' => ['description', ['descriptionChars' => 200], 50],
    'description longer: still 50' => ['description', ['descriptionChars' => 500], 50],
    'cover with focal point: 30' => ['cover_focal', ['coverFocal' => true], 30],
    'documented mods 25 each' => ['documented_mods', ['documentedMods' => 3], 75],
    'documented mods capped at 10 (250)' => ['documented_mods', ['documentedMods' => 12], 250],
    'registered mods 5 each' => ['registered_mods', ['registeredMods' => 2], 10],
    'registered mods capped at 10 (50)' => ['registered_mods', ['registeredMods' => 11], 50],
    'reactors 2 each' => ['reactors', ['reactors' => 7], 14],
    'reactors capped at 100' => ['reactors', ['reactors' => 80], 100],
    'spotters 1 each' => ['spotters', ['spotters' => 9], 9],
    'spotters capped at 100' => ['spotters', ['spotters' => 150], 100],
    'followers 1 each' => ['followers', ['followers' => 12], 12],
    'followers capped at 50' => ['followers', ['followers' => 70], 50],
    'timeline 10 each' => ['timeline', ['timeline' => 3], 30],
    'timeline capped at 80' => ['timeline', ['timeline' => 20], 80],
    'before/after 15 each' => ['before_after', ['beforeAfter' => 2], 30],
    'before/after capped at 45' => ['before_after', ['beforeAfter' => 5], 45],
    'history 1 per month' => ['history_span', ['historyMonths' => 7], 7],
    'history capped at 25' => ['history_span', ['historyMonths' => 60], 25],
]);

it('caps every part and the total, so the maximum is exactly 1000', function () {
    $everything = scoreOf([
        'photos' => 99, 'keySpecs' => 99, 'descriptionChars' => 999, 'coverFocal' => true, 'documentedMods' => 99, 'registeredMods' => 99,
        'reactors' => 999, 'spotters' => 999, 'followers' => 999, 'timeline' => 99, 'beforeAfter' => 99, 'historyMonths' => 999,
    ]);

    expect($everything['total'])->toBe(1000)
        ->and($everything['stage'])->toBe(5)
        ->and(array_map(fn (array $part): int => $part['points'], $everything['parts']))
        ->toBe(['completeness' => 300, 'documentation' => 300, 'community' => 250, 'journey' => 150]);
    expect(scoreOf([])['total'])->toBe(0);
});

it('splits the points into the four parts', function () {
    $result = scoreOf(['photos' => 3, 'documentedMods' => 1, 'reactors' => 2, 'timeline' => 1]);

    expect($result['parts'])->toBe([
        'completeness' => ['points' => 60, 'max' => 300],
        'documentation' => ['points' => 25, 'max' => 300],
        'community' => ['points' => 4, 'max' => 250],
        'journey' => ['points' => 10, 'max' => 150],
    ])->and($result['total'])->toBe(99);
});

it('puts a score into stages 1 to 5 at 0, 200, 400, 600 and 800', function (int $total, int $stage) {
    expect(calc()->stage($total))->toBe($stage);
})->with([[0, 1], [199, 1], [200, 2], [399, 2], [400, 3], [599, 3], [600, 4], [799, 4], [800, 5], [1000, 5]]);

it('reads the formula from config', function () {
    config(['speedclub.build_score.parts.completeness.photos' => ['points' => 5, 'limit' => 2]]);

    expect(calc()->calculate(new BuildScoreFacts(photos: 9))['total'])->toBe(10);
});

it('lists the owner\'s next upgrades with points and progress, most points first, never community or time', function () {
    $upgrades = calc()->nextUpgrades(new BuildScoreFacts(
        photos: 2, keySpecs: 8, descriptionChars: 120, coverFocal: false, documentedMods: 1, undocumentedMods: 2, registeredMods: 0,
        existingMods: 3, plannedMods: 1, reactors: 3, spotters: 1, followers: 0, timeline: 2, beforeAfter: 0, historyMonths: 1,
    ));
    $byKey = collect($upgrades)->keyBy('key');

    expect(array_column($upgrades, 'key'))->not->toContain('reactors', 'spotters', 'followers', 'history_span')
        ->and($byKey['photos'])->toMatchArray(['points' => 80, 'progress' => ['have' => 2, 'need' => 6]])
        ->and($byKey['key_specs'])->toMatchArray(['points' => 20, 'progress' => ['have' => 8, 'need' => 10]])
        ->and($byKey['description'])->toMatchArray(['points' => 50, 'progress' => ['have' => 120, 'need' => 200]])
        ->and($byKey['cover_focal'])->toMatchArray(['points' => 30, 'progress' => ['have' => 0, 'need' => 1]])
        // Two mods miss brand, photo or date: completing them is worth 2 × 25.
        ->and($byKey['documented_mods'])->toMatchArray(['points' => 50, 'progress' => ['have' => 1, 'need' => 3]])
        ->and($byKey['planned_mods'])->toMatchArray(['points' => 25, 'progress' => ['have' => 0, 'need' => 1]])
        ->and($byKey['registered_mods'])->toMatchArray(['points' => 15, 'progress' => ['have' => 0, 'need' => 3]])
        ->and($byKey['timeline'])->toMatchArray(['points' => 10, 'progress' => ['have' => 2, 'need' => 3]])
        ->and($byKey['before_after'])->toMatchArray(['points' => 15, 'progress' => ['have' => 0, 'need' => 1]])
        ->and(array_column($upgrades, 'points'))->toBe(collect($upgrades)->pluck('points')->sortDesc()->values()->all())
        ->and($upgrades[0]['label_key'])->toBe($upgrades[0]['key']);
});

it('suggests one more documented mod when every mod is documented and none is planned, and nothing once everything is full', function () {
    $one = calc()->nextUpgrades(new BuildScoreFacts(documentedMods: 2, existingMods: 2));
    expect(collect($one)->firstWhere('key', 'documented_mods'))->toMatchArray(['points' => 25, 'progress' => ['have' => 2, 'need' => 3]]);

    $full = calc()->nextUpgrades(new BuildScoreFacts(
        photos: 6, keySpecs: 10, descriptionChars: 300, coverFocal: true, documentedMods: 10, registeredMods: 10, existingMods: 10,
        plannedMods: 4, timeline: 8, beforeAfter: 3,
    ));
    expect($full)->toBe([]);
});
