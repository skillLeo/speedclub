<?php

namespace App\Enums;

/**
 * What an e-mail code of login_attempts proves (09 §8.1): a sign-in or new account, an AUTH-16 provider link, a recent authentication
 * ("sudo mode"), an e-mail change. A code only ever counts for its own purpose.
 */
enum LoginPurpose: string
{
    case SignIn = 'sign_in';
    case Link = 'link';
    case Reauth = 'reauth';
    case ChangeEmail = 'change_email';
}
