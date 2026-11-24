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
    // M4.6: this Apple or Google identity already belongs to another Speedclub account.
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
    // SEC-414-01: the mod already carries another business's confirmed "Eingebaut von"; the build's owner takes it off first (it is
    // never replaced silently).
    case BusinessTagTaken = 'business_tag_taken';
    // M4.14 (09 §8.9): a product that does not exist or is not in the catalogue any more.
    case ProductUnavailable = 'product_unavailable';
    // M5.9b STREET DEX (m5.9b contract §2): a scanned code that is no sticker of ours.
    case QrNotFound = 'qr_not_found';
    // M5.9b: the sticker leads nowhere a spot can go (revoked or inactive code, a deleted, private or hidden car, a block either way);
    // the same answer for each, so nothing is learnt about a car one cannot see.
    case SpotUnavailable = 'spot_unavailable';
    // M5.9b: a member cannot spot their own car.
    case SpotOwnCar = 'spot_own_car';
    // M5.9b: the owner paused spotting of this car.
    case SpottingPaused = 'spotting_paused';
    // M5.9e: the Season Wrapped is not released yet (remote config wrapped.releases).
    case WrappedNotReleased = 'wrapped_not_released';
    // M5.9d: the story line can be edited only while the car is the Car of the Day on Home.
    case NotCarOfTheDay = 'not_car_of_the_day';
    // M5.4 Sticker (m5.4-contract §4, §7): the server could not read the code back from the rendered sticker; the design stays a draft.
    case StickerScanFailed = 'sticker_scan_failed';
    // M5.4: print files and the order link need a design that passed the Scan-Test.
    case StickerNotValidated = 'sticker_not_validated';
    // M5.4: a design with QR needs the car's active code, and staff took it down (only staff issue the next one).
    case StickerNoActiveCode = 'sticker_no_active_code';
    // M5.4: the code this version was validated with is no longer active (replaced or taken down): validate the design again.
    case StickerCodeReplaced = 'sticker_code_replaced';

    // M5.3: "Als verbaut markieren" on a mod that is not (or no longer) planned.
    case ModNotPlanned = 'mod_not_planned';

    // M5.5 Shop (m5.5-contract §3): a product that is unknown, hidden, deleted or a sample while samples are off.
    case ShopProductUnavailable = 'shop_product_unavailable';
    // M5.5: the catalogue driver cannot answer (the Shopify Storefront driver before it is built, or the store is down).
    case ShopUnavailable = 'shop_unavailable';

    // M5.8 Forum: a locked thread or one not published yet takes no replies; a thread others answered cannot be deleted by its author.
    case ForumThreadClosed = 'forum_thread_closed';
    case ForumThreadHasReplies = 'forum_thread_has_replies';

    // M5.6 Treffen gallery (m5.6-contract §4.4): uploads outside the window (starts_at … end + 14 days; `opens_at`, `closes_at`), by
    // somebody who is neither the organiser nor going nor checked in, a decision on a photo that is no longer pending, and a photo that
    // does not exist or that the reader may not see.
    case GalleryClosed = 'gallery_closed';
    case GalleryNotAttendee = 'gallery_not_attendee';
    case PhotoAlreadyReviewed = 'photo_already_reviewed';
    case EventPhotoUnavailable = 'event_photo_unavailable';
    // M5.6 check-in (m5.6-contract §5.3): a wrong or expired code, outside the window (`opens_at`, `closes_at`), the organiser's own event.
    case CheckinCodeInvalid = 'checkin_code_invalid';
    case CheckinClosed = 'checkin_closed';
    case CheckinOwnEvent = 'checkin_own_event';

    // R4-2.3 Crews: a crew that does not exist, or one the reader may not see (hidden or removed by staff for everybody but its members,
    // deleted, a sample while samples are off); the same answer for each.
    case CrewUnavailable = 'crew_unavailable';

    public function status(): int
    {
        return match ($this) {
            self::BadRequest => 400,
            self::Unauthenticated, self::InvalidCredentials, self::InvalidIdentityToken => 401,
            self::Forbidden, self::AccountRestricted, self::EmailNotVerified, self::PasswordChangeRequired, self::QrRevokedByStaff, self::CannotMessage, self::SecondFactorLocked, self::PasswordConfirmationRequired, self::ViewAsReadOnly, self::ViewAsNoMessages, self::ViewAsPrivate, self::AiOptInRequired, self::ConsentRequired, self::TermsRequired, self::ReauthenticationRequired, self::EditWindowClosed, self::CommentsDisabled, self::OrganiserNotEligible, self::WrappedNotReleased, self::GalleryClosed, self::GalleryNotAttendee, self::CheckinOwnEvent => 403,
            self::NotFound, self::VehicleUnavailable, self::MemberUnavailable, self::FeatureDisabled, self::EventUnavailable, self::BusinessUnavailable, self::ProductUnavailable, self::QrNotFound, self::ShopProductUnavailable, self::EventPhotoUnavailable, self::CrewUnavailable => 404,
            self::MethodNotAllowed => 405,
            self::Conflict, self::UsernameChangeCooldown, self::TokenRotationNotDue, self::TwoFactorRequired, self::IdempotencyKeyReused, self::FeedStale, self::RequestPending, self::AlreadyReported, self::AppealExists, self::ProviderAlreadyLinked, self::LastSignInMethod, self::LimitReached, self::EventClosed, self::EventInReview, self::EditConflict, self::BusinessExists, self::BusinessNotVerified, self::BusinessTagTaken, self::SpotUnavailable, self::SpotOwnCar, self::SpottingPaused, self::NotCarOfTheDay, self::StickerNotValidated, self::StickerNoActiveCode, self::StickerCodeReplaced, self::ModNotPlanned, self::ForumThreadClosed, self::ForumThreadHasReplies, self::PhotoAlreadyReviewed, self::CheckinClosed => 409,
            self::PayloadTooLarge => 413,
            self::UnsupportedMediaType => 415,
            self::SessionExpired => 419,
            self::ValidationFailed, self::InvalidCode, self::VehicleIncomplete, self::OwnContent, self::AppealPeriodOver, self::ChallengeExpired, self::TwoFactorCodeRequired, self::DecisionNotAppealable, self::ContentBlocked, self::AiRefused, self::AiUnverifiable, self::CodeExpired, self::PasskeyInvalid, self::StickerScanFailed, self::CheckinCodeInvalid => 422,
            self::Maintenance => 423,
            self::UpgradeRequired => 426,
            self::RateLimited, self::AiDailyLimit, self::EmailCodeLocked => 429,
            self::ServerError => 500,
            self::ServiceUnavailable, self::AiUnavailable, self::AiBudgetExhausted, self::GeocodeUnavailable, self::ShopUnavailable => 503,
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
