<?php

namespace App\Support;

use App\Enums\PowerDisplay;
use App\Enums\PowerUnit;

/**
 * Power conversion and display (02_PRODUCT_SPEC §3.2, §3.9).
 *
 * The entered value and unit are stored untouched in vehicle_specs. power_ps is only the normalised
 * value for filtering and sorting, so display goes back to the entered value instead of converting twice.
 */
final class Units
{
    public const PS_PER_KW = 1.35962;

    public const PS_PER_HP = 1.01387;

    /**
     * Value for the power_ps column.
     */
    public static function toPs(float|int $value, PowerUnit $unit): float
    {
        return round(self::exactPs($value, $unit), 2);
    }

    public static function toKw(float|int $value, PowerUnit $unit): float
    {
        return $unit === PowerUnit::Kw ? (float) $value : self::exactPs($value, $unit) / self::PS_PER_KW;
    }

    public static function toHp(float|int $value, PowerUnit $unit): float
    {
        return $unit === PowerUnit::Hp ? (float) $value : self::exactPs($value, $unit) / self::PS_PER_HP;
    }

    /**
     * "510 PS (375 kW)" · "375 kW (510 PS)" · "503 hp", rounded to integers and grouped per locale.
     */
    public static function formatPower(float|int $value, PowerUnit $unit, PowerDisplay $display, string $locale = 'de'): string
    {
        $ps = self::formatInteger(self::exactPs($value, $unit), $locale).' PS';
        $kw = self::formatInteger(self::toKw($value, $unit), $locale).' kW';

        return match ($display) {
            PowerDisplay::PsKw => "$ps ($kw)",
            PowerDisplay::KwPs => "$kw ($ps)",
            PowerDisplay::Hp => self::formatInteger(self::toHp($value, $unit), $locale).' hp',
        };
    }

    /**
     * The spec strip's split of the same setting: the leading unit only, value and unit apart ("510" over "PS").
     *
     * @return array{value: string, unit: string}
     */
    public static function powerParts(float|int $value, PowerUnit $unit, PowerDisplay $display, string $locale = 'de'): array
    {
        return match ($display) {
            PowerDisplay::PsKw => ['value' => self::formatInteger(self::exactPs($value, $unit), $locale), 'unit' => 'PS'],
            PowerDisplay::KwPs => ['value' => self::formatInteger(self::toKw($value, $unit), $locale), 'unit' => 'kW'],
            PowerDisplay::Hp => ['value' => self::formatInteger(self::toHp($value, $unit), $locale), 'unit' => 'hp'],
        };
    }

    /**
     * "1.500", "9,5" (de) and "1,500", "9.5" (en): grouped, with decimals only where the value has them.
     */
    public static function formatNumber(float|int $value, string $locale = 'de', int $maxDecimals = 2): string
    {
        [$point, $thousands] = $locale === 'de' ? [',', '.'] : ['.', ','];

        $formatted = number_format((float) $value, $maxDecimals, $point, $thousands);

        return $maxDecimals > 0 ? rtrim(rtrim($formatted, '0'), $point) : $formatted;
    }

    /**
     * "1.234,50" (de), "1,234.50" (en), "1.234" for whole euros: money has two decimals or none, without the currency.
     */
    public static function formatMoney(int $cents, string $locale = 'de'): string
    {
        [$point, $thousands] = $locale === 'de' ? [',', '.'] : ['.', ','];

        return number_format($cents / 100, $cents % 100 === 0 ? 0 : 2, $point, $thousands);
    }

    /**
     * "2.568 cm³"
     */
    public static function formatDisplacement(int $cubicCentimetres, string $locale = 'de'): string
    {
        return self::formatNumber($cubicCentimetres, $locale, 0).' cm³';
    }

    /**
     * "2,6 l"
     */
    public static function formatDisplacementShort(int $cubicCentimetres, string $locale = 'de'): string
    {
        return number_format($cubicCentimetres / 1000, 1, $locale === 'de' ? ',' : '.', '').' l';
    }

    /**
     * "650 Nm"
     */
    public static function formatTorque(int $newtonMetres, string $locale = 'de'): string
    {
        return self::formatNumber($newtonMetres, $locale, 0).' Nm';
    }

    /**
     * "−35 mm" with the real minus sign. Lowering is stored as a positive amount.
     */
    public static function formatLowering(float|int $millimetres, string $locale = 'de'): string
    {
        return "\u{2212}".self::formatNumber($millimetres, $locale).' mm';
    }

    private static function exactPs(float|int $value, PowerUnit $unit): float
    {
        return match ($unit) {
            PowerUnit::Ps => (float) $value,
            PowerUnit::Kw => $value * self::PS_PER_KW,
            PowerUnit::Hp => $value * self::PS_PER_HP,
        };
    }

    private static function formatInteger(float $value, string $locale): string
    {
        return number_format($value, 0, '', $locale === 'de' ? '.' : ',');
    }
}
