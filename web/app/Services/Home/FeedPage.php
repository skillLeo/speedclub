<?php

namespace App\Services\Home;

/**
 * One page of GET feed with its cursor; suggestions only for an empty first page of "Folge ich".
 */
final readonly class FeedPage
{
    /**
     * @param  list<FeedItem>  $items
     * @param  list<ActiveMember>|null  $suggestions
     */
    public function __construct(
        public array $items,
        public ?string $nextCursor,
        public int $perPage,
        public ?array $suggestions = null,
    ) {}
}
