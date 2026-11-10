<?php

use App\Support\Slug;

it('transliterates German the German way', function (string $text, string $slug) {
    expect(Slug::make($text))->toBe($slug);
})->with([
    ['Müller', 'mueller'],
    ['Größe', 'groesse'],
    ['Käfer', 'kaefer'],
    ['Straße', 'strasse'],
    ['ÖKO Über', 'oeko-ueber'],
    ['Citroën', 'citroen'],
    ['Škoda', 'skoda'],
    ['Mercedes-Benz', 'mercedes-benz'],
    ['Alfa  Romeo', 'alfa-romeo'],
    ['Z3/M3', 'z3-m3'],
    ['1.8 T', '1-8-t'],
    ['A & B', 'a-b'],
    ['!!!', ''],
]);

it('builds the vehicle slug from make, model, generation and public_id', function () {
    expect(Slug::forVehicle('BMW', 'M4', 'G82', '7H2KQXMB'))->toBe('bmw-m4-g82-7h2kqxmb');
});

it('leaves out missing parts', function (?string $make, ?string $model, ?string $generation, string $slug) {
    expect(Slug::forVehicle($make, $model, $generation, '7H2KQXMB'))->toBe($slug);
})->with([
    ['BMW', 'M4', null, 'bmw-m4-7h2kqxmb'],
    ['BMW', null, '', 'bmw-7h2kqxmb'],
    [null, null, null, '7h2kqxmb'],
    ['!!!', null, null, '7h2kqxmb'],
]);

it('limits long free-text names and keeps the public_id', function () {
    $slug = Slug::forVehicle(str_repeat('sehr lang ', 40), null, null, '7H2KQXMB');

    expect(strlen($slug))->toBeLessThanOrEqual(129)
        ->and($slug)->toEndWith('-7h2kqxmb')
        ->and($slug)->not->toContain('--');
});

it('resolves by the public_id alone', function (string $slug, ?string $publicId) {
    expect(Slug::publicId($slug))->toBe($publicId);
})->with([
    'canonical' => ['bmw-m4-g82-7h2kqxmb', '7H2KQXMB'],
    'different text part' => ['irgendwas-anderes-7h2kqxmb', '7H2KQXMB'],
    'uppercase' => ['BMW-7H2KQXMB', '7H2KQXMB'],
    'id only' => ['7h2kqxmb', '7H2KQXMB'],
    'too short' => ['bmw-m4-g82', null],
    'invalid characters' => ['bmw-m4-7h2kqxmu', null],
    'empty' => ['', null],
]);
