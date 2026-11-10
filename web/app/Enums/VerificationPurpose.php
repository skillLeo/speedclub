<?php

namespace App\Enums;

use App\Support\Enums\HasLabel;

enum VerificationPurpose: string
{
    use HasLabel;

    case EmailVerification = 'email_verification';
    case PasswordReset = 'password_reset';
    case EmailChange = 'email_change';
}
