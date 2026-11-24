<?php

namespace App\Services\Dex;

/**
 * The `filter` of GET me/dex: all, rarity:{tier}, make:{slug} or set:{key} (m5.9b contract §3).
 */
final readonly class DexFilter
{
    public const PATTERN = '/\A(all|rarity:(street|tuned|rare|legend|ghost)|make:[a-z0-9][a-z0-9-]{0,79}|set:[a-z0-9][a-z0-9-]{0,59})\z/';

    public function __construct(public string $kind, public string $value = '') {}

    public static function parse(?string $filter): self
    {
        if ($filter === null || $filter === '' || $filter === 'all') {
            return new self('all');
        }

        [$kind, $value] = explode(':', $filter, 2) + [1 => ''];

        return new self($kind, $value);
    }
}
