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
    // M4.13 ruling (ADR-441): view-as never shows a member's maintenance, service log, odometer or private costs.
    case ViewAsPrivate = 'view_as_private';
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
    // M4.6 (09 §8.1): a passwordless account has not accepted AGB, Datenschutz and the age line yet (AUTH-09b, POST me/onboarding/accept).
    case TermsRequired = 'terms_required';
    // M4.6 "sudo mode": the endpoint needs POST me/reauth within the last 10 minutes; `methods` names what this member can use.
    case ReauthenticationRequired = 'reauthentication_required';
    // M4.6 AUTH-13: the e-mail code is older than 10 minutes; a new one is needed.
    case CodeExpired = 'code_expired';
    // M4.6 AUTH-13: 10 wrong codes in an hour for this address; `retry_after` seconds until the 15-minute lock ends.
    case EmailCodeLocked = 'email_code_locked';
    // M4.6: an Apple or Google ID token that fails verification (signature, issuer, audience, time, nonce, unverified e-mail).
    case InvalidIdentityToken = 'invalid_identity_token';
    // M4.6: this Apple or Google identity already belongs to another SPEED CLUB account.
    case ProviderAlreadyLinked = 'provider_already_linked';
    // M4.6: unlinking or deleting this sign-in method would leave the account without any way in.
    case LastSignInMethod = 'last_sign_in_method';
    // M4.6: a passkey ceremony that fails (unknown, expired or spent ceremony, wrong origin, bad signature, counter regression).
    case PasskeyInvalid = 'passkey_invalid';
    // M4.11 (09 §8.5): a build update can be edited within 24 hours of posting; hiding and deleting stay open.
    case EditWindowClosed = 'edit_window_closed';
    // M4.11 [build_comments]: the owner turned comments off for this vehicle.
    case CommentsDisabled = 'comments_disabled';
    // M4.11 (09 §8.5/§8.6): the limit of an owner-curated list is reached (8 highlights, collections, items).
    case LimitReached = 'limit_reached';
    // M4.12 (09 §8.7): an event that does not exist, or one the reader may not see (draft, pending, rejected, blocked organiser, samples
    // while hidden, followers-only); the same answer for each, so nothing is learnt about an event one cannot see.
    case EventUnavailable = 'event_unavailable';
    // M4.12: the event is cancelled or over (RSVP, updates), or not in a state the action needs (submit a published event, cancel twice).
    case EventClosed = 'event_closed';
    // M4.12 (09 §8.7 creation rights): the account is younger than 14 days; `eligible_at` names when it may organise.
    case OrganiserNotEligible = 'organiser_not_eligible';
    // M4.12: the geocoding service did not answer in time or is not configured; the organiser can still place the pin by hand.
    case GeocodeUnavailable = 'geocode_unavailable';
    // M4.12 security review (SEC-412-01): the event is with staff for review; it cannot be changed until they decided.
    case EventInReview = 'event_in_review';
    // M4.13 (09 §8.12 offline outbox): the edit started from an older `version` of the row; the body's `current` holds the server's row.
    case EditConflict = 'edit_conflict';
    // M4.14 (09 §8.10): a business profile that does not exist, or one the reader may not see (applied, rejected, suspended, removed,
    // samples while hidden, a block with its owner); the same answer for each.
    case BusinessUnavailable = 'business_unavailable';
    // M4.14: the member already owns or works for a business (one per member), or the business is not in the state the action needs.
    case BusinessExists = 'business_exists';
    // M4.14: portfolio tags need a verified business on both ends (a pending, rejected or suspended business cannot tag or be tagged).
    case BusinessNotVerified = 'business_not_verified';
    // M4.14 (09 §8.9): a product that does not exist or is not in the catalogue any more.
    case ProductUnavailable = 'product_unavailable';

    public function status(): int
    {
        return match ($this) {
            self::BadRequest => 400,
            self::Unauthenticated, self::InvalidCredentials, self::InvalidIdentityToken => 401,
            self::Forbidden, self::AccountRestricted, self::EmailNotVerified, self::PasswordChangeRequired, self::QrRevokedByStaff, self::CannotMessage, self::SecondFactorLocked, self::PasswordConfirmationRequired, self::ViewAsReadOnly, self::ViewAsNoMessages, self::ViewAsPrivate, self::AiOptInRequired, self::ConsentRequired, self::TermsRequired, self::ReauthenticationRequired, self::EditWindowClosed, self::CommentsDisabled, self::OrganiserNotEligible => 403,
            self::NotFound, self::VehicleUnavailable, self::MemberUnavailable, self::FeatureDisabled, self::EventUnavailable, self::BusinessUnavailable, self::ProductUnavailable => 404,
            self::MethodNotAllowed => 405,
            self::Conflict, self::UsernameChangeCooldown, self::TokenRotationNotDue, self::TwoFactorRequired, self::IdempotencyKeyReused, self::FeedStale, self::RequestPending, self::AlreadyReported, self::AppealExists, self::ProviderAlreadyLinked, self::LastSignInMethod, self::LimitReached, self::EventClosed, self::EventInReview, self::EditConflict, self::BusinessExists, self::BusinessNotVerified => 409,
            self::PayloadTooLarge => 413,
            self::UnsupportedMediaType => 415,
            self::SessionExpired => 419,
            self::ValidationFailed, self::InvalidCode, self::VehicleIncomplete, self::OwnContent, self::AppealPeriodOver, self::ChallengeExpired, self::TwoFactorCodeRequired, self::DecisionNotAppealable, self::ContentBlocked, self::AiRefused, self::AiUnverifiable, self::CodeExpired, self::PasskeyInvalid => 422,
            self::Maintenance => 423,
            self::UpgradeRequired => 426,
            self::RateLimited, self::AiDailyLimit, self::EmailCodeLocked => 429,
            self::ServerError => 500,
            self::ServiceUnavailable, self::AiUnavailable, self::AiBudgetExhausted, self::GeocodeUnavailable => 503,
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
