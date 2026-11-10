<?php

namespace App\Enums;

/**
 * Audit actions of staff security events (05_ARCHITECTURE §13, 06_ADMIN_SPEC §1). The staff IP address goes to
 * audit_event_access, outside the chain (ADR-113). No secret, code or recovery code ever reaches the row.
 */
enum StaffSecurityEvent: string
{
    /** A new secret for an account without confirmed TOTP. Counts only once confirmed. */
    case TwoFactorEnabled = 'staff.two_factor_enabled';
    case TwoFactorConfirmed = 'staff.two_factor_confirmed';
    case TwoFactorDisabled = 'staff.two_factor_disabled';
    case RecoveryCodesRegenerated = 'staff.recovery_codes_regenerated';
    case RecoveryCodeUsed = 'staff.recovery_code_used';

    /** A session that signed in without a code, ended by EnsureStaffTwoFactor once the account has confirmed TOTP (SEC-P1-32). */
    case SessionEndedWithoutCode = 'staff.session_ended_without_code';

    // M3.1 (SEC-P1-03): sign-in and the password steps.
    case SignedIn = 'staff.signed_in';
    case SignedOut = 'staff.signed_out';
    /** A wrong password for an existing account. Unknown addresses leave no row: anyone could fill the chain with them. */
    case SignInFailed = 'staff.sign_in_failed';
    case TwoFactorFailed = 'staff.two_factor_failed';
    case PasswordChanged = 'staff.password_changed';
    case PasswordReset = 'staff.password_reset';
    /** A wrong password at the confirmation or the password change of a signed-in session (SEC-P1-26). */
    case PasswordCheckFailed = 'staff.password_check_failed';

    /** Ended by EnsureStaffActive: the account is no longer active (SEC-P1-25). */
    case SessionEndedInactive = 'staff.session_ended_inactive';
    /** Ended by EnsureStaffActive: the password or the second factor changed after this session signed in (SEC-P1-25). */
    case SessionEndedCredentialsChanged = 'staff.session_ended_credentials_changed';

    // M3.6 ADM-51 (SEC-P1-36, SEC-P1-39): the staff member's own account.
    /** A new key is pending; the old one keeps working until the new one is confirmed with its own code. */
    case TwoFactorRotationStarted = 'staff.two_factor_rotation_started';
    case TwoFactorRotated = 'staff.two_factor_rotated';
    case TwoFactorRotationCancelled = 'staff.two_factor_rotation_cancelled';
    /** Recovery codes shown after a current code (SEC-P1-36: reading them leaves a row). */
    case RecoveryCodesViewed = 'staff.recovery_codes_viewed';
    /** A wrong current code at a rotation or recovery-code step. */
    case CodeCheckFailed = 'staff.code_check_failed';
    case OwnSessionRevoked = 'staff.own_session_revoked';
}
