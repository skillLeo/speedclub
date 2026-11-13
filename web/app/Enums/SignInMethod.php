<?php

namespace App\Enums;

/**
 * How a member proved who they are at sign-in (SET-21 "Anmeldung mit Passkey"). A sign-in with a second factor keeps its first proof.
 */
enum SignInMethod: string
{
    case Password = 'password';
    case EmailCode = 'email_code';
    case Passkey = 'passkey';
    case Apple = 'apple';
    case Google = 'google';

    public static function forProvider(SocialProvider $provider): self
    {
        return $provider === SocialProvider::Apple ? self::Apple : self::Google;
    }
}
