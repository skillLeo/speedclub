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
    // M4.6 Auth 2.0 (09 §8.1/§8.2): e-mail code lock, provider link/unlink, passkey added/removed/refused (counter regression).
    case EmailCodeLocked = 'email_code_locked';
    case ProviderLinked = 'provider_linked';
    case ProviderUnlinked = 'provider_unlinked';
    case PasskeyAdded = 'passkey_added';
    case PasskeyRemoved = 'passkey_removed';
    case PasskeyRejected = 'passkey_rejected';
    // M4.7 (09 §8.4): "Das war ich nicht" signed every device out and opened a support request.
    case AccountSecured = 'account_secured';
}
