<?php

use App\Enums\PowerSource;
use App\Enums\Visibility;
use Tests\Support\SourceScanner;

$labelled = function (): array {
    $root = dirname(__DIR__, 2);

    return array_values(array_filter(
        SourceScanner::classesIn("$root/app", ["$root/app/Enums"]),
        fn (string $enum) => method_exists($enum, 'label'),
    ));
};

it('has labelled enums to check', function () use ($labelled) {
    expect(count($labelled()))->toBeGreaterThanOrEqual(28);
});

it('has a German and an English label for every case of every enum', function () use ($labelled) {
    $missing = [];

    foreach ($labelled() as $enum) {
        foreach ($enum::cases() as $case) {
            foreach (['de', 'en'] as $locale) {
                if (str_starts_with($case->label($locale), 'enums.')) {
                    $missing[] = "$enum::{$case->name} ($locale)";
                }
            }
        }
    }

    expect($missing)->toBe([]);
});

it('follows the app locale', function () {
    app()->setLocale('de');
    expect(PowerSource::Claimed->label())->toBe('Besitzerangabe');

    app()->setLocale('en');
    expect(PowerSource::Claimed->label())->toBe('Owner figure')
        ->and(Visibility::Private->label('de'))->toBe('Privat');
});
