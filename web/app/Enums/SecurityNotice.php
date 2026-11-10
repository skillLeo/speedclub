<?php

namespace App\Enums;

/**
 * Member security events that send their mandatory mail and an in-app row (02_PRODUCT_SPEC §7). M2.5 raises email_changed,
 * two_factor_changed, sessions_revoked and deletion_requested, and password_changed from SET-04 as well as from the reset.
 */
enum SecurityNotice: string
{
    case NewDevice = 'new_device';
    case PasswordChanged = 'password_changed';
    case EmailChanged = 'email_changed';
    case TwoFactorChanged = 'two_factor_changed';
    case DeletionRequested = 'deletion_requested';
    case SessionsRevoked = 'sessions_revoked';
    // M2.5 fix round: a wrong password or second factor after a correct first step (variants password, second_factor, locked).
    case VerificationFailed = 'verification_failed';
    // M2.5 fix round: a sign-in with a recovery code, naming how many are left.
    case RecoveryCodeUsed = 'recovery_code_used';
}
