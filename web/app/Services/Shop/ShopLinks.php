<?php

namespace App\Services\Shop;

use App\Enums\ShopPurchaseMode;
use App\Services\Shop\Views\ShopBuyView;

/**
 * Every address "Im Shop kaufen" may open (m5.5-contract §3.3, §4). Admin input must be https on an allowed host (ShopDomain), path
 * /products/{handle}, at most the query `variant=<digits>`; it is stored normalised. At read time the host is checked again, so taking a
 * host out of the config turns its links off instead of leaving them live. A variant with a Shopify id becomes the cart permalink
 * /cart/{variant_id}:1?storefront=true (the syntax M5.4 verified for STK-06), which lands in the store's cart, not in its checkout.
 */
final class ShopLinks
{
    public function __construct(private readonly ShopDomain $domain) {}

    /**
     * The normalised product URL, or null when the input breaks a rule.
     */
    public function normalise(string $input): ?string
    {
        $input = trim($input);

        if ($input === '' || strlen($input) > 500 || preg_match('/[\s\x00-\x1f\\\\]/', $input) === 1) {
            return null;
        }

        $parts = parse_url($input);

        if (! is_array($parts) || strtolower($parts['scheme'] ?? '') !== 'https' || ! isset($parts['host'])
            || isset($parts['user']) || isset($parts['pass']) || isset($parts['port']) || isset($parts['fragment'])) {
            return null;
        }

        $host = strtolower($parts['host']);
        $path = rtrim($parts['path'] ?? '', '/');

        if (! $this->domain->allows($host) || preg_match('#\A/products/([a-z0-9][a-z0-9-]{0,254})\z#', $path, $handle) !== 1) {
            return null;
        }

        $query = '';

        if (isset($parts['query']) && $parts['query'] !== '') {
            if (preg_match('/\Avariant=(\d{1,20})\z/', $parts['query'], $variant) !== 1) {
                return null;
            }
            $query = '?variant='.$variant[1];
        }

        return 'https://'.$host.'/products/'.$handle[1].$query;
    }

    /**
     * The product's own buy link.
     */
    public function product(ShopPurchaseMode $mode, ?string $url): ShopBuyView
    {
        if ($mode === ShopPurchaseMode::StickerDesigner) {
            return ShopBuyView::designer();
        }

        $live = $url === null ? null : $this->normalise($url);

        return $live === null ? ShopBuyView::unavailable() : ShopBuyView::external($live);
    }

    /**
     * A variant's link: the cart permalink on the product's host when it carries a Shopify variant id, else the product's own link.
     */
    public function variant(ShopPurchaseMode $mode, ?string $url, ?string $variantId): ShopBuyView
    {
        $product = $this->product($mode, $url);

        if ($product->kind !== ShopBuyView::EXTERNAL || $variantId === null || preg_match('/\A\d{1,20}\z/', $variantId) !== 1) {
            return $product;
        }

        $host = (string) parse_url((string) $product->url, PHP_URL_HOST);

        return ShopBuyView::external('https://'.$host.'/cart/'.$variantId.':1?storefront=true');
    }

    /**
     * @return array{configured: bool, host: string|null, shipping_url: string|null}
     */
    public function store(): array
    {
        $host = $this->domain->host();

        return [
            'configured' => $host !== null,
            'host' => $host,
            'shipping_url' => $host === null ? null : 'https://'.$host.config()->string('speedclub.shop.shipping_path'),
        ];
    }
}
