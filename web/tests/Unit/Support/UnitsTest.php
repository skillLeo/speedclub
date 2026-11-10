<?php

use App\Enums\PowerDisplay;
use App\Enums\PowerUnit;
use App\Support\Units;

it('normalises power to PS with the exact factors of the spec', function (float|int $value, PowerUnit $unit, float $ps) {
    expect(Units::toPs($value, $unit))->toBe($ps);
})->with([
    'PS stays as entered' => [510, PowerUnit::Ps, 510.0],
    'fractional PS stays as entered' => [510.5, PowerUnit::Ps, 510.5],
    '375 kW' => [375, PowerUnit::Kw, 509.86],
    '1 kW' => [1, PowerUnit::Kw, 1.36],
    '100 hp' => [100, PowerUnit::Hp, 101.39],
    '1 hp' => [1, PowerUnit::Hp, 1.01],
    '0 kW' => [0, PowerUnit::Kw, 0.0],
]);

it('uses the conversion factors from the spec', function () {
    expect(Units::PS_PER_KW)->toBe(1.35962)
        ->and(Units::PS_PER_HP)->toBe(1.01387);
});

it('keeps a value in its entered unit without a round trip', function () {
    expect(Units::toKw(375, PowerUnit::Kw))->toBe(375.0)
        ->and(Units::toHp(500, PowerUnit::Hp))->toBe(500.0);
});

it('converts between kW and hp through PS', function () {
    expect(Units::toKw(510, PowerUnit::Ps))->toEqualWithDelta(375.105, 0.001)
        ->and(Units::toHp(375, PowerUnit::Kw))->toEqualWithDelta(502.88, 0.01)
        ->and(Units::toKw(500, PowerUnit::Hp))->toEqualWithDelta(372.85, 0.01);
});

it('formats power per display setting, rounded to integers', function (float|int $value, PowerUnit $unit, PowerDisplay $display, string $locale, string $expected) {
    expect(Units::formatPower($value, $unit, $display, $locale))->toBe($expected);
})->with([
    'spec example' => [510, PowerUnit::Ps, PowerDisplay::PsKw, 'de', '510 PS (375 kW)'],
    'entered kW shows that kW' => [375, PowerUnit::Kw, PowerDisplay::PsKw, 'de', '510 PS (375 kW)'],
    'kW first' => [510, PowerUnit::Ps, PowerDisplay::KwPs, 'de', '375 kW (510 PS)'],
    'hp only' => [375, PowerUnit::Kw, PowerDisplay::Hp, 'de', '503 hp'],
    'German grouping' => [1500, PowerUnit::Ps, PowerDisplay::PsKw, 'de', '1.500 PS (1.103 kW)'],
    'English grouping' => [1500, PowerUnit::Ps, PowerDisplay::PsKw, 'en', '1,500 PS (1,103 kW)'],
]);
