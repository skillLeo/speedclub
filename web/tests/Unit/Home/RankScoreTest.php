<?php

use App\Services\Home\RankScore;

/**
 * The Für dich score of 02_PRODUCT_SPEC §3.8 (M2.2): every factor on its own, then together.
 */
it('halves with every 72 hours since the last change', function (float $hours, float $decay) {
    expect(RankScore::decay($hours))->toEqualWithDelta($decay, 1e-9);
})->with([
    'just now' => [0.0, 1.0],
    'one half-life' => [72.0, 0.5],
    'two half-lives' => [144.0, 0.25],
    'a day' => [24.0, 0.5 ** (1 / 3)],
    'a future date counts as now' => [-5.0, 1.0],
]);

it('rates the cover by its long edge', function (?int $edge, float $quality) {
    expect(RankScore::quality($edge))->toBe($quality);
})->with([
    '2560' => [2560, 1.0],
    '1600 exactly' => [1600, 1.0],
    '1599' => [1599, 0.85],
    '1080 exactly' => [1080, 0.85],
    '1079' => [1079, 0.7],
    'no cover' => [null, 0.7],
]);

it('adds engagement on a log scale and caps it', function () {
    expect(RankScore::engagement(0, 0))->toBe(0.0)
        ->and(RankScore::engagement(1, 0))->toEqualWithDelta(0.1 * log(2), 1e-12)
        ->and(RankScore::engagement(0, 1))->toEqualWithDelta(0.05 * log(2), 1e-12)
        ->and(RankScore::engagement(3, 2))->toEqualWithDelta(0.1 * log(4) + 0.05 * log(3), 1e-12)
        ->and(RankScore::engagement(10_000, 10_000))->toBe(0.3)
        // Ten more saves on a popular build add less than the first one did.
        ->and(RankScore::engagement(11, 0) - RankScore::engagement(10, 0))->toBeLessThan(RankScore::engagement(1, 0));
});

it('multiplies decay, completeness and quality, then adds engagement and the editorial boost', function () {
    $fresh = RankScore::score(0, 100, 1600, 0, 0, false);
    $old = RankScore::score(72, 100, 1600, 0, 0, false);
    $half = RankScore::score(0, 50, 1600, 0, 0, false);
    $small = RankScore::score(0, 100, 800, 0, 0, false);

    expect($fresh)->toBe(1.0)
        ->and($old)->toBe(0.5)
        ->and($half)->toBe(0.5)
        ->and($small)->toBe(0.7)
        ->and(RankScore::score(0, 100, 1600, 1, 0, false))->toBe(round(1 + 0.1 * log(2), 6))
        ->and(RankScore::score(0, 100, 1600, 0, 0, true))->toBe(1.5)
        // A long-forgotten build keeps its engagement and its boost, nothing else.
        ->and(RankScore::score(100_000, 100, 1600, 3, 0, true))->toBe(round(0.1 * log(4) + 0.5, 6))
        ->and(RankScore::score(0, 0, 1600, 0, 0, false))->toBe(0.0);
});

it('rounds to six decimals and formats for cursors and SQL', function () {
    $score = RankScore::score(10, 77, 1200, 2, 1, false);

    expect(round($score, 6))->toBe($score)
        ->and(RankScore::format($score))->toMatch('/\A\d+\.\d{6}\z/')
        ->and((float) RankScore::format($score))->toBe($score)
        ->and(RankScore::format(1.5))->toBe('1.500000');
});

it('follows the numbers in config', function () {
    config(['speedclub.home.ranking.half_life_hours' => 24, 'speedclub.home.ranking.admin_boost' => 0.2]);

    expect(RankScore::decay(24))->toEqualWithDelta(0.5, 1e-12)
        ->and(RankScore::score(0, 100, 1600, 0, 0, true))->toBe(1.2);
});
