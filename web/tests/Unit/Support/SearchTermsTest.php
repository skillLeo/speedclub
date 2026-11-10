<?php

use App\Services\Search\SearchTerms;

it('stores words joined and in their parts, folded both ways', function () {
    expect(SearchTerms::keys(['Nissan', 'Skyline GT-R', 'R34', null, '', 'E90/E92/E93', 'Blüe']))
        ->toBe(' nissan skyline gtr gt r r34 e90e92e93 e90 e92 e93 bluee blue ');
});

it('stays inside its byte budget and never cuts a word', function () {
    $keys = SearchTerms::keys(['alpha beta gamma delta'], 18);

    expect($keys)->toBe(' alpha beta gamma ')
        ->and(strlen($keys))->toBeLessThanOrEqual(18)
        ->and(SearchTerms::keys([]))->toBe('');
});

it('reads a stored phrase to its end, however long (SEC-M18-02)', function () {
    $phrase = str_repeat('Gewindefahrwerk ', 200).'Zielwort';

    expect(strlen($phrase))->toBeGreaterThan(3000)
        ->and(SearchTerms::keys([$phrase]))->toBe(' gewindefahrwerk zielwort ');
});

it('reads only the first 1000 characters of a query', function () {
    $query = str_repeat(' ', 995).'abc defgh';

    expect(SearchTerms::queryWords($query))->toBe(['abc', 'd'])
        ->and(SearchTerms::nameWords($query))->toBe(['abc', 'd']);
});

it('turns a query into joined words, at most six, without duplicates', function () {
    expect(SearchTerms::queryWords(' GT-R  r34, gtr; Müller '))->toBe(['gtr', 'r34', 'mueller'])
        ->and(SearchTerms::queryWords('a b c d e f g'))->toBe(['a', 'b', 'c', 'd', 'e', 'f'])
        ->and(SearchTerms::queryWords('-- !!'))->toBe([])
        ->and(SearchTerms::queryWords('100%_'))->toBe(['100']);
});

it('keeps member names as typed, lowercase, without the @', function () {
    expect(SearchTerms::nameWords('@Max.E46  Müller'))->toBe(['max.e46', 'müller'])
        ->and(SearchTerms::nameWords('-- @'))->toBe([]);
});

it('escapes LIKE wildcards for ESCAPE \'!\'', function () {
    expect(SearchTerms::escapeLike('a_b%c!d'))->toBe('a!_b!%c!!d');
});
