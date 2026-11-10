<?php

namespace App\Services\Catalog;

use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * The reason of a catalogue Action (m3.1 contract §0: 10–1000 characters where 06 says "with reason": deactivate, delete, merge, reject,
 * field schema changes, import apply). Create and edit take an optional one.
 */
final class Reason
{
    /**
     * @throws ValidationException
     */
    public static function required(?string $reason): string
    {
        $reason = trim((string) $reason);
        Validator::make(['reason' => $reason], ['reason' => ['required', 'string', 'min:10', 'max:1000']])->validate();

        return $reason;
    }

    /**
     * @throws ValidationException
     */
    public static function optional(?string $reason): ?string
    {
        $reason = trim((string) $reason);

        if ($reason === '') {
            return null;
        }

        Validator::make(['reason' => $reason], ['reason' => ['string', 'max:1000']])->validate();

        return $reason;
    }
}
