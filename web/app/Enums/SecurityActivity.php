<?php

namespace App\Enums;

/**
 * The rows of SET-21 Sicherheitsaktivität (09 §7.9, §8.4): what a member sees of their member_security_events. Several audit actions
 * can share a row type (both locks are `sign_in_locked`); bookkeeping events (registration, token rotation, renames) are not shown.
 */
enum SecurityActivity: string
{
    case SignedIn = 'signed_in';
    case NewDevice = 'new_device';
    case SignInFailed = 'sign_in_failed';
    case SignInLocked = 'sign_in_locked';
    case PasswordChanged = 'password_changed';
    case PasswordReset = 'password_reset';
    case EmailChanged = 'email_changed';
    case TwoFactorEnabled = 'two_factor_enabled';
    case TwoFactorDisabled = 'two_factor_disabled';
    case RecoveryCodesRegenerated = 'recovery_codes_regenerated';
    case RecoveryCodeUsed = 'recovery_code_used';
    case PasskeyAdded = 'passkey_added';
    case PasskeyRemoved = 'passkey_removed';
    case PasskeyRejected = 'passkey_rejected';
    case ProviderLinked = 'provider_linked';
    case ProviderUnlinked = 'provider_unlinked';
    case SessionsRevoked = 'sessions_revoked';
    case SignedOutEverywhere = 'signed_out_everywhere';
    case TokenReplayBlocked = 'token_replay_blocked';
    case AccountSecured = 'account_secured';
    case DataExportRequested = 'data_export_requested';
    case DeletionRequested = 'deletion_requested';

    public static function fromEvent(MemberSecurityEvent $event): ?self
    {
        return match ($event) {
            MemberSecurityEvent::SignedIn => self::SignedIn,
            MemberSecurityEvent::LoginNewDevice => self::NewDevice,
            MemberSecurityEvent::SignInFailed => self::SignInFailed,
            MemberSecurityEvent::EmailCodeLocked, MemberSecurityEvent::SecondFactorLocked => self::SignInLocked,
            MemberSecurityEvent::PasswordChanged => self::PasswordChanged,
            MemberSecurityEvent::PasswordReset => self::PasswordReset,
            MemberSecurityEvent::EmailChanged => self::EmailChanged,
            MemberSecurityEvent::TwoFactorEnabled => self::TwoFactorEnabled,
            MemberSecurityEvent::TwoFactorDisabled => self::TwoFactorDisabled,
            MemberSecurityEvent::RecoveryCodesRegenerated => self::RecoveryCodesRegenerated,
            MemberSecurityEvent::RecoveryCodeUsed => self::RecoveryCodeUsed,
            MemberSecurityEvent::PasskeyAdded => self::PasskeyAdded,
            MemberSecurityEvent::PasskeyRemoved => self::PasskeyRemoved,
            MemberSecurityEvent::PasskeySignCountRegressed => self::PasskeyRejected,
            MemberSecurityEvent::ProviderLinked => self::ProviderLinked,
            MemberSecurityEvent::ProviderUnlinked => self::ProviderUnlinked,
            MemberSecurityEvent::SessionRevoked => self::SessionsRevoked,
            MemberSecurityEvent::LogoutAll => self::SignedOutEverywhere,
            MemberSecurityEvent::TokenReplayed => self::TokenReplayBlocked,
            MemberSecurityEvent::AccountSecured => self::AccountSecured,
            MemberSecurityEvent::DataExportRequested => self::DataExportRequested,
            MemberSecurityEvent::DeletionRequested => self::DeletionRequested,
            default => null,
        };
    }

    /**
     * The audit actions SET-21 lists.
     *
     * @return list<string>
     */
    public static function shownEvents(): array
    {
        return array_values(array_map(
            fn (MemberSecurityEvent $event): string => $event->value,
            array_filter(MemberSecurityEvent::cases(), fn (MemberSecurityEvent $event): bool => self::fromEvent($event) !== null),
        ));
    }

    /**
     * Whether the row offers "Das war ich nicht": something that could have been done by somebody else with access to the account.
     */
    public function securable(): bool
    {
        return match ($this) {
            self::SignedIn, self::NewDevice, self::SignInFailed, self::PasswordChanged, self::PasswordReset, self::EmailChanged,
            self::TwoFactorEnabled, self::TwoFactorDisabled, self::RecoveryCodesRegenerated, self::RecoveryCodeUsed, self::PasskeyAdded,
            self::ProviderLinked, self::DataExportRequested => true,
            default => false,
        };
    }
}
