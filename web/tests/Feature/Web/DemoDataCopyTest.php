<?php

use Illuminate\Support\Arr;
use Illuminate\Support\Facades\File;

// The demo data is what a client reads first, so it writes values the way a German reader does (03 §4, DQ-177).
// A closure and not a named function: Pest loads every test file into one process, and a second file with the same
// function name would be a fatal redeclaration.
$demoData = fn (): array => File::json(database_path('data/demo.json'), JSON_THROW_ON_ERROR);

it('writes every bolt pattern with a multiplication sign and a decimal comma (DQ-177)', function () use ($demoData) {
    $patterns = collect(Arr::array($demoData(), 'vehicles'))
        ->flatMap(fn (array $vehicle): array => $vehicle['mods'] ?? [])
        ->map(fn (array $mod): mixed => $mod['f']['bolt_pattern'] ?? null)
        ->filter()
        ->unique()
        ->values();

    expect($patterns)->toContain('5×114,3', '5×112', '5×120');

    foreach ($patterns as $pattern) {
        expect($pattern)->toMatch('/^\d×\d+(,\d+)?$/u');
    }
});

it('has no decimal point in a value shown to a German reader (DQ-177)', function () use ($demoData) {
    // A point before three figures is a thousands separator ("8.400 Touren"). "2.5-16" is the maker's own name of the 190 E, as the badge writes it.
    $decimals = array_filter(
        array_filter(Arr::flatten($demoData()), is_string(...)),
        fn (string $text): bool => preg_match('/(?<!\d)\d+\.\d{1,2}(?!\d)/u', str_replace('2.5-16', '', $text)) === 1,
    );

    expect(array_values($decimals))->toBe([]);
});

it('keeps the figure and the noun of the photo rule together, in both languages (DQ-183)', function () {
    expect(__('garage.completeness.photos', [], 'de'))->toBe("Mindestens 3\u{00A0}Fotos")
        ->and(__('garage.completeness.photos', [], 'en'))->toBe("At least 3\u{00A0}photos");
});

it('keeps "Art. 21" together in the redress texts of the moderation e-mails, in both languages (DQ-429)', function (string $key) {
    foreach (['de', 'en'] as $locale) {
        expect(__($key, [], $locale))->toContain("Art.\u{00A0}21")->not->toContain('Art. 21');
    }
})->with(['moderation.mail.decision.redress.out_of_court', 'moderation.mail.outcome.redress', 'moderation.mail.outcome.redress_no_date']);
