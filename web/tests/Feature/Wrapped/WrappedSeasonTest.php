<?php

use App\Services\Wrapped\Season;

require_once __DIR__.'/WrappedTestHelpers.php';

/**
 * M5.9e (m5.9e contract §1, §8): the season window math. `YYYY-saison` = 1 March to 31 October, `YYYY-jahr` = the calendar year, both
 * in Europe/Berlin.
 */
it('reads a season as 1 March to 31 October in Berlin', function () {
    $season = Season::from('2027-saison');

    expect($season->year)->toBe(2027)
        ->and($season->kind)->toBe('saison')
        ->and($season->isYear())->toBeFalse()
        ->and($season->fromDate())->toBe('2027-03-01')
        ->and($season->toDate())->toBe('2027-10-31')
        // CET on both ends: winter time until 28 March, again from 31 October 2027 03:00.
        ->and($season->fromUtc()->toDateTimeString())->toBe('2027-02-28 23:00:00')
        ->and($season->toUtc()->toDateTimeString())->toBe('2027-10-31 22:59:59');
});

it('reads a year as the Berlin calendar year', function () {
    $season = Season::from('2027-jahr');

    expect($season->isYear())->toBeTrue()
        ->and($season->fromDate())->toBe('2027-01-01')
        ->and($season->toDate())->toBe('2027-12-31')
        ->and($season->fromUtc()->toDateTimeString())->toBe('2026-12-31 23:00:00')
        ->and($season->toUtc()->toDateTimeString())->toBe('2027-12-31 22:59:59');
});

it('knows the edges of the window', function (string $moment, bool $inside) {
    expect(Season::from('2027-saison')->contains(wrIn($moment)))->toBe($inside);
})->with([
    'last minute of February' => ['2027-02-28 23:59:59', false],
    'first moment of March' => ['2027-03-01 00:00:00', true],
    'summer' => ['2027-07-15 12:00:00', true],
    'last second of October' => ['2027-10-31 23:59:59', true],
    'first moment of November' => ['2027-11-01 00:00:00', false],
]);

it('refuses any other key', function (mixed $key) {
    expect(Season::tryFrom($key))->toBeNull();
})->with(['2027-winter', '27-saison', '2027-SAISON', '2027-saison ', 'saison-2027', '1999-saison', '', null, 2027]);
