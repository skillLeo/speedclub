<?php

namespace App\Services\Shop;

/**
 * The one Shopify store of Speedclub (m5.5-contract §4, ADR-524): "Sticker bestellen" (STK-06) and every shop product link go to it, so
 * the two can never point at different stores. The host comes from speedclub.stickers.shop.domain (SHOPIFY_STORE_DOMAIN, a bare host:
 * "speedclub.myshopify.com" or the store's own domain; a scheme or path someone typed is dropped); speedclub.shop.extra_hosts adds more
 * hosts a product URL may use (e.g. the store's myshopify.com address). Never a wildcard.
 */
final class ShopDomain
{
    public function host(): ?string
    {
        return self::normalise(config('speedclub.stickers.shop.domain'));
    }

    public function configured(): bool
    {
        return $this->host() !== null;
    }

    /**
     * The store host first, then the extra hosts; empty while no store is configured (an extra host alone opens nothing).
     *
     * @return list<string>
     */
    public function allowedHosts(): array
    {
        $host = $this->host();

        if ($host === null) {
            return [];
        }

        $extra = config('speedclub.shop.extra_hosts');
        $hosts = [$host];

        foreach (is_string($extra) ? explode(',', $extra) : (is_array($extra) ? $extra : []) as $candidate) {
            $normalised = self::normalise($candidate);

            if ($normalised !== null && ! in_array($normalised, $hosts, true)) {
                $hosts[] = $normalised;
            }
        }

        return $hosts;
    }

    public function allows(string $host): bool
    {
        return in_array(strtolower($host), $this->allowedHosts(), true);
    }

    public static function normalise(mixed $value): ?string
    {
        if (! is_string($value) || trim($value) === '') {
            return null;
        }

        $value = trim($value);
        $host = parse_url(str_contains($value, '://') ? $value : 'https://'.$value, PHP_URL_HOST);

        return is_string($host) && preg_match('/\A[a-z0-9.-]+\.[a-z]{2,}\z/i', $host) === 1 ? strtolower($host) : null;
    }
}
