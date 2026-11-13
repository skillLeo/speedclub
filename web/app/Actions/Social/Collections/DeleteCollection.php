<?php

namespace App\Actions\Social\Collections;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\MemberCollection;
use App\Services\Social\Collections;

/**
 * Deletes a named collection with its entries (the app offers undo by re-creating from its own copy). "Gespeichert" stays: 409.
 */
class DeleteCollection
{
    public function __construct(private readonly Collections $collections) {}

    public function handle(MemberCollection $collection): void
    {
        if ($collection->is_default) {
            throw new ApiException(ErrorCode::Conflict, (string) __('social.collections.default_locked'));
        }

        $this->collections->deleted($collection);
    }
}
