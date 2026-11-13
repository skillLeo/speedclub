<?php

namespace App\Enums;

/**
 * The server half of a WebAuthn ceremony (passkey_challenges): a sign-in (usernameless), a registration, or a re-authentication of the
 * signed-in member.
 */
enum PasskeyCeremony: string
{
    case Authentication = 'authentication';
    case Registration = 'registration';
    case Reauth = 'reauth';
}
