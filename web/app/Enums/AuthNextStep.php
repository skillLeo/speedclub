<?php

namespace App\Enums;

/**
 * What the client shows after a neutral auth answer. Never depends on whether the account exists.
 */
enum AuthNextStep: string
{
    case VerifyEmail = 'verify_email';
    case ResetPassword = 'reset_password';
    case SignIn = 'sign_in';
}
