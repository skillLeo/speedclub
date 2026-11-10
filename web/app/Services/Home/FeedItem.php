<?php

namespace App\Services\Home;

use App\Enums\FeedItemType;
use App\Models\BuildUpdate;
use App\Models\Vehicle;

/**
 * An item of GET feed: a vehicle card or an update row. at and id are what "Folge ich" pages on.
 */
final class FeedItem
{
    public function __construct(
        public readonly FeedItemType $type,
        public readonly string $id,
        public readonly ?Vehicle $vehicle,
        public readonly ?BuildUpdate $update,
        public readonly string $at = '',
    ) {}

    public function key(): string
    {
        return $this->type->value.':'.$this->id;
    }
}
