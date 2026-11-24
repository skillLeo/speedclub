<?php

namespace App\Services\Shop;

/**
 * The gross price as text (m5.5-contract §3.2), without the intl extension (shared hosting may lack it): de "14,90 €" (no-break space
 * before the sign), en "€14.90". Only EUR exists in M5.5; another code is written in front, as ISO codes are.
 */
final class ShopPrice
{
    public static function format(int $cents, string $currency = 'EUR', ?string $locale = null): string
    {
        $locale ??= app()->getLocale();
        $english = str_starts_with($locale, 'en');
        $amount = number_format($cents / 100, 2, $english ? '.' : ',', $english ? ',' : '.');
        $sign = $currency === 'EUR' ? '€' : $currency;

        if ($english) {
            return $currency === 'EUR' ? $sign.$amount : $sign."\u{00A0}".$amount;
        }

        return $amount."\u{00A0}".$sign;
    }
}
