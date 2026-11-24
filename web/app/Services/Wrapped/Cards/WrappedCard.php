<?php

namespace App\Services\Wrapped\Cards;

use App\Services\Wrapped\WrappedContext;

/**
 * One card of a Wrapped (m5.9e contract §3). `build` answers the stored card (references and numbers, no URLs and no words: the API
 * resolves those per request) or null when the member has nothing for it in the season: a card without data is left out, never a
 * card that says 0.
 */
interface WrappedCard
{
    public function kind(): string;

    /**
     * @return array<string, mixed>|null
     */
    public function build(WrappedContext $context): ?array;
}
