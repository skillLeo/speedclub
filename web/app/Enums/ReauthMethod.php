<?php

namespace App\Enums;

/**
 * How POST me/reauth proves the member again (09 §8.1 "sudo mode").
 */
enum ReauthMethod: string
{
    case Passkey = 'passkey';
    case EmailCode = 'email_code';
    case Password = 'password';
}
