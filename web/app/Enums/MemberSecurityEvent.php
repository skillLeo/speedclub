<?php

namespace App\Enums;

/**
 * Audit actions of member security events (05_ARCHITECTURE §13). Never with an IP address (ADR-113). Each one also becomes a row of
 * member_security_events (SecurityEventLog), which SET-21 reads through SecurityActivity.
 */
enum MemberSecurityEvent: string
{
    case Registered = 'member.registered';
    case EmailVerified = 'member.email_verified';
    case LoginNewDevice = 'member.login_new_device';
    case PasswordReset = 'member.password_reset';
    case PasswordChanged = 'member.password_changed';
    case UsernameChanged = 'member.username_changed';
    case LogoutAll = 'member.logout_all';
    case QrReissued = 'member.qr_reissued';
    case TokenReplayed = 'member.token_replayed';
    case TokenRotationRetried = 'member.token_rotation_retried';
    // M2.5 settings (SET-03 to SET-06, SET-12, SET-13, WEB-05).
    case EmailChangeRequested = 'member.email_change_requested';
    case EmailChanged = 'member.email_changed';
    case TwoFactorEnabled = 'member.two_factor_enabled';
    case TwoFactorDisabled = 'member.two_factor_disabled';
    case RecoveryCodesRegenerated = 'member.recovery_codes_regenerated';
    case RecoveryCodeUsed = 'member.recovery_code_used';
    case SessionRevoked = 'member.session_revoked';
    case DataExportRequested = 'member.data_export_requested';
    case DataExportDownloaded = 'member.data_export_downloaded';
    case DeletionRequested = 'member.deletion_requested';
    case HardDeleted = 'member.hard_deleted';
    case SecondFactorLocked = 'member.second_factor_locked';
    case PasswordCheckFailed = 'member.password_check_failed';
    // M4.6 Auth 2.0 (09 §8.1/§8.2).
    case EmailCodeLocked = 'member.email_code_locked';
    case TermsAccepted = 'member.terms_accepted';
    case ProviderLinked = 'member.provider_linked';
    case ProviderUnlinked = 'member.provider_unlinked';
    case ProviderLinkRequested = 'member.provider_link_requested';
    case AppleRevoked = 'member.apple_revoked';
    case PasskeyAdded = 'member.passkey_added';
    case PasskeyRenamed = 'member.passkey_renamed';
    case PasskeyRemoved = 'member.passkey_removed';
    case PasskeySignCountRegressed = 'member.passkey_sign_count_regressed';
    case Reauthenticated = 'member.reauthenticated';
    // SEC-M46-01: the owner proved an address someone else had registered; that someone's passkeys and providers went with the rest.
    case UnprovenDataCleared = 'member.unproven_data_cleared';
    // M4.7 account security (09 §8.4): every sign-in (a new device is LoginNewDevice instead), wrong sign-in proofs as one row per day
    // and account, and "Das war ich nicht" (SET-21, the mail link).
    case SignedIn = 'member.signed_in';
    case SignInFailed = 'member.sign_in_failed';
    case AccountSecured = 'member.account_secured';
}
