<?php

namespace App\Enums;

/**
 * Audit actions of member security events (05_ARCHITECTURE §13). Never with an IP address (ADR-113).
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
}
