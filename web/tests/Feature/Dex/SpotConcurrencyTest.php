<?php

use Illuminate\Support\Facades\DB;

require_once __DIR__.'/DexTestHelpers.php';

/**
 * M5.9b part 2 (contract §9 "first-three race"). A real race needs two connections that see the same committed car, and every Feature
 * test runs inside one uncommitted transaction (RefreshDatabase) on a database other lanes share, so a second connection would see
 * nothing and committed rows would leak. The guarantee rests on two facts this file pins instead:
 *
 * 1. RecordSpot reads everything the first-three decision and the 24 h duplicate rule depend on only after it took the car's row lock
 *    (SELECT … FOR UPDATE) inside its transaction, so two spots of one car are serialised by InnoDB: the second waits for the first's
 *    commit and then counts its spot.
 * 2. Run one after the other, the fourth distinct spotter gets no foil and a second spot of the same member within 24 h is the duplicate
 *    (SpotWriteTest covers the sequential rules in full).
 */
it('takes the car\'s row lock before it reads the spots the first-three and duplicate rules count', function () {
    [, $code] = dexCar();
    $spotter = dexMember();

    DB::enableQueryLog();
    dexSpot($spotter, $code)->assertCreated();
    $queries = array_map(fn (array $query): string => strtolower($query['query']), DB::getQueryLog());
    DB::disableQueryLog();

    $lock = array_key_first(array_filter($queries, fn (string $sql): bool => str_contains($sql, 'from `vehicles`') && str_ends_with(trim($sql), 'for update')));
    $spotReads = array_keys(array_filter($queries, fn (string $sql): bool => str_starts_with($sql, 'select') && str_contains($sql, 'from `spots`')));
    $insert = array_key_first(array_filter($queries, fn (string $sql): bool => str_starts_with($sql, 'insert into `spots`')));

    expect($lock)->not->toBeNull()
        ->and($spotReads)->not->toBe([])
        ->and($insert)->not->toBeNull()
        ->and(min($spotReads))->toBeGreaterThan($lock)
        ->and($insert)->toBeGreaterThan($lock);
});

it('gives the foil to the first three distinct spotters only, one after the other', function () {
    [, $code] = dexCar();
    $foils = [];

    foreach (range(1, 4) as $ignored) {
        $foils[] = dexSpot(dexMember(), $code)->assertCreated()->json('meta.first_spotter');
    }

    expect($foils)->toBe([true, true, true, false]);
});
