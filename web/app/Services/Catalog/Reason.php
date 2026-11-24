<?php

namespace App\Services\Catalog;

use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;

/**
 * The reason of an admin Action. ADR-540 (client decision 2026-11-23): staff give no internal reason any more, so internal() takes an
 * optional one (≤ 1000 characters; '' when absent, recorded as null by Audit::record()). required() (10–1000 characters) is left for a
 * reason the member reads, e.g. a rejected catalogue request. optional() returns null for an empty reason.
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
     * ADR-540: an optional internal reason, trimmed; '' when none was given.
     *
     * @throws ValidationException
     */
    public static function internal(?string $reason): string
    {
        $reason = trim((string) $reason);
        Validator::make(['reason' => $reason], ['reason' => ['nullable', 'string', 'max:1000']])->validate();

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
