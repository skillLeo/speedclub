<?php

namespace App\Enums;

/**
 * Machine-readable API error codes (05_ARCHITECTURE §7).
 * Messages live in lang/{de,en}/errors.php under the same key.
 */
enum ErrorCode: string
{
    case BadRequest = 'bad_request';
    case Unauthenticated = 'unauthenticated';
    case Forbidden = 'forbidden';
    case AccountRestricted = 'account_restricted';
    case NotFound = 'not_found';
    case MethodNotAllowed = 'method_not_allowed';
    case Conflict = 'conflict';
    case PayloadTooLarge = 'payload_too_large';
    case UnsupportedMediaType = 'unsupported_media_type';
    case SessionExpired = 'session_expired';
    case ValidationFailed = 'validation_failed';
    case Maintenance = 'maintenance';
    case UpgradeRequired = 'upgrade_required';
    case RateLimited = 'rate_limited';
    case ServerError = 'server_error';
    case ServiceUnavailable = 'service_unavailable';
    case InvalidCredentials = 'invalid_credentials';
    case EmailNotVerified = 'email_not_verified';
    case PasswordChangeRequired = 'password_change_required';
    case InvalidCode = 'invalid_code';
    case UsernameChangeCooldown = 'username_change_cooldown';
    case TokenRotationNotDue = 'token_rotation_not_due';
    case VehicleUnavailable = 'vehicle_unavailable';
    case MemberUnavailable = 'member_unavailable';
    case FeatureDisabled = 'feature_disabled';
    case VehicleIncomplete = 'vehicle_incomplete';
    case QrRevokedByStaff = 'qr_revoked_by_staff';
    case TwoFactorRequired = 'two_factor_required';
    case IdempotencyKeyReused = 'idempotency_key_reused';
    // M2.2 review #8: a Für dich cursor of a ranking that has been replaced since; the app reloads the stream from the top.
    case FeedStale = 'feed_stale';
    // M2.4: the sender may not write to this member now (`reason`: recipient_closed, not_verified, restricted); a block looks the same.
    case CannotMessage = 'cannot_message';
    // M2.4: a message request already carries the sender's one message; the recipient has not accepted it.
    case RequestPending = 'request_pending';
    // M2.6: the member already reported this target and the case is still open.
    case AlreadyReported = 'already_reported';
    // M2.6: a member cannot report their own profile or content.
    case OwnContent = 'own_content';
    // M2.6: this member already appealed this decision (one appeal per person and decision).
    case AppealExists = 'appeal_exists';
    // M2.6: the six months for an appeal (§§ 187, 188 BGB, Europe/Berlin) are over.
    case AppealPeriodOver = 'appeal_period_over';
    // M2.5 AUTH-11: the two-factor challenge is unknown, spent or older than 5 minutes; the app starts the sign-in again.
    case ChallengeExpired = 'challenge_expired';
    // M2.5 fix round: too many wrong second factors (10 an hour, 20 a day); a password reset by e-mail code lifts it.
    case SecondFactorLocked = 'second_factor_locked';
    // M3.1 (SEC-P2-07): with two-factor on, an e-mail or password change also needs a current code.
    case TwoFactorCodeRequired = 'two_factor_code_required';
    // M3.1 (ADR-215): a sensitive admin write needs a password confirmed within the last five minutes.
    case PasswordConfirmationRequired = 'password_confirmation_required';
    // M3.2 view-as (m3.2-contract §3): a view-as token reads only, and never messages.
    case ViewAsReadOnly = 'view_as_read_only';
    case ViewAsNoMessages = 'view_as_no_messages';
    // M3.2: a reverse decision lifted a measure; there is nothing to appeal.
    case DecisionNotAppealable = 'decision_not_appealable';
    // M3.4 (ADM-23): the text holds a term of the keyword block list (the message never names it).
    case ContentBlocked = 'content_blocked';
    // M3.7 [AI] (m3.7 contract §1): a suggestion feature without the member's opt-in (SET privacy "KI-Vorschläge").
    case AiOptInRequired = 'ai_opt_in_required';
    // The provider failed or timed out, or the feature's daily budget is spent.
    case AiUnavailable = 'ai_unavailable';
    case AiBudgetExhausted = 'ai_budget_exhausted';
    // The model declined the request as outside what the feature may do (02 §6 "Never"), or a post-check rejected the answer.
    case AiRefused = 'ai_refused';
    case AiUnverifiable = 'ai_unverifiable';
    // SEC-P3-19: the member's own daily share of an [AI] feature is used up (the platform budget is not); again tomorrow.
    case AiDailyLimit = 'ai_daily_limit';
    // ADR-245: a member write while a re-consent version (AGB or Datenschutz) is not accepted; GET me/consents names it.
    case ConsentRequired = 'consent_required';

    public function status(): int
    {
        return match ($this) {
            self::BadRequest => 400,
            self::Unauthenticated, self::InvalidCredentials => 401,
            self::Forbidden, self::AccountRestricted, self::EmailNotVerified, self::PasswordChangeRequired, self::QrRevokedByStaff, self::CannotMessage, self::SecondFactorLocked, self::PasswordConfirmationRequired, self::ViewAsReadOnly, self::ViewAsNoMessages, self::AiOptInRequired, self::ConsentRequired => 403,
            self::NotFound, self::VehicleUnavailable, self::MemberUnavailable, self::FeatureDisabled => 404,
            self::MethodNotAllowed => 405,
            self::Conflict, self::UsernameChangeCooldown, self::TokenRotationNotDue, self::TwoFactorRequired, self::IdempotencyKeyReused, self::FeedStale, self::RequestPending, self::AlreadyReported, self::AppealExists => 409,
            self::PayloadTooLarge => 413,
            self::UnsupportedMediaType => 415,
            self::SessionExpired => 419,
            self::ValidationFailed, self::InvalidCode, self::VehicleIncomplete, self::OwnContent, self::AppealPeriodOver, self::ChallengeExpired, self::TwoFactorCodeRequired, self::DecisionNotAppealable, self::ContentBlocked, self::AiRefused, self::AiUnverifiable => 422,
            self::Maintenance => 423,
            self::UpgradeRequired => 426,
            self::RateLimited, self::AiDailyLimit => 429,
            self::ServerError => 500,
            self::ServiceUnavailable, self::AiUnavailable, self::AiBudgetExhausted => 503,
        };
    }

    public static function fromStatus(int $status): self
    {
        return match ($status) {
            401 => self::Unauthenticated,
            403 => self::Forbidden,
            404 => self::NotFound,
            405 => self::MethodNotAllowed,
            409 => self::Conflict,
            413 => self::PayloadTooLarge,
            415 => self::UnsupportedMediaType,
            419 => self::SessionExpired,
            422 => self::ValidationFailed,
            423 => self::Maintenance,
            426 => self::UpgradeRequired,
            429 => self::RateLimited,
            503 => self::ServiceUnavailable,
            default => $status >= 500 ? self::ServerError : self::BadRequest,
        };
    }

    public function message(): string
    {
        return (string) __('errors.'.$this->value);
    }
}
