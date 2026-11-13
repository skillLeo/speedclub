<?php

namespace App\Services\Auth\Passkeys;

use App\Models\MemberPasskey;
use RuntimeException;

/**
 * The authenticator's signature counter did not grow (09 §8.2): a sign of a cloned key. The ceremony is refused and reported.
 */
final class PasskeyCounterRegressed extends RuntimeException
{
    public function __construct(public readonly MemberPasskey $passkey)
    {
        parent::__construct('Passkey signature counter regressed.');
    }
}
