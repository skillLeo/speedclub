<?php

namespace App\Http\Middleware;

use App\Enums\ErrorCode;
use App\Enums\WhoCanMessage;
use App\Exceptions\ApiException;
use App\Models\User;
use App\Services\Content\Consents;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * ADR-245: re-consent is enforced on the server too. Part of the `member` middleware group (ConsentServiceProvider), after
 * auth:sanctum: while the member has not accepted the current version of a re-consent document (AGB or Datenschutz published with
 * "erfordert erneute Zustimmung", Consents::outstanding()), every write answers 403 `consent_required`. Reads stay open, so the app
 * can load GET me/consents and show the sheet.
 *
 * Writes that stay open (EXEMPT, by route name): accepting (POST me/consents); signing out (this device, other devices, the push
 * token of this install, and the token rotation that keeps a signed-in app from being signed out while the sheet waits); the GDPR
 * rights (data export, account deletion); the support contact (a new request and an answer in a thread); the DSA rights of a member
 * (an appeal against a decision, a report of illegal content); ending a staff view-as; and (ADR-248 amended, SF-1) the safety and
 * rights paths: blocking and unblocking a member, deleting one's own vehicle, photo, mod, message or conversation (Art. 17 short of
 * deleting the account), and the realtime channel auth (a read in POST form).
 *
 * Writes that stay open only when they restrict (RESTRICTING, checked on the payload): PATCH me/settings when every key sent only
 * narrows privacy or withdraws a consent (discoverable, indexable, show_owner_on_qr, read_receipts and ai_suggestions set to false,
 * who_can_message narrowed — never widened — from the member's current value; Art. 7(3) withdrawal as easy as giving), and PATCH
 * vehicles/{vehicle}/visibility to `private`. Any other key or value in the same request keeps the refusal, so theme, language,
 * notifications or a wider audience still wait for the acceptance.
 */
class EnsureCurrentConsent
{
    public const EXEMPT = [
        'api.v1.me.consents.store',
        // Signing out, and what keeps the session of this install alive.
        'api.v1.auth.logout',
        'api.v1.me.sessions.destroy',
        'api.v1.me.sessions.destroy-others',
        'api.v1.auth.token.rotate',
        'api.v1.me.push-tokens.store',
        'api.v1.me.push-tokens.destroy',
        // GDPR rights (Art. 15, 17, 20).
        'api.v1.me.exports.store',
        'api.v1.me.delete',
        // The support contact.
        'api.v1.support.tickets.store',
        'api.v1.support.tickets.messages.store',
        // DSA Art. 16 and 20.
        'api.v1.decisions.appeal',
        'api.v1.reports.store',
        // A view-as token is read-only anyway (RestrictViewAs); ending it must work.
        'api.v1.view-as.destroy',
        // Safety: keeping a member away (ADR-248 amended, SF-1).
        'api.v1.blocks.store',
        'api.v1.blocks.destroy',
        // Deleting one's own content (GDPR Art. 17 short of deleting the account).
        'api.v1.vehicles.destroy',
        'api.v1.media.destroy',
        'api.v1.mods.destroy',
        'api.v1.messages.destroy',
        'api.v1.conversations.destroy',
        // Realtime channel auth: a read in POST form; a refusal would leave pusher-js on the poll until the next reconnect.
        'api.v1.broadcasting.auth',
    ];

    /**
     * M4.6 (09 §8.1): a passwordless account before AUTH-09b may also accept the terms and set up how it signs in (sudo mode, passkeys,
     * linked providers); everything else waits, so nothing public exists before the acceptance. Answer 403 terms_required.
     */
    public const PENDING_TERMS_EXEMPT = [
        'api.v1.me.onboarding.accept',
        'api.v1.me.reauth',
        'api.v1.me.reauth.email',
        'api.v1.me.reauth.passkey-options',
        'api.v1.me.passkeys.options',
        'api.v1.me.passkeys.store',
        'api.v1.me.passkeys.update',
        'api.v1.me.passkeys.destroy',
        'api.v1.me.providers.destroy',
    ];

    /**
     * Writes that stay open while every key of the payload is listed here with a value that only restricts: a list of allowed
     * values, or `narrow` for an ordered setting (WHO_CAN_MESSAGE_ORDER) that may not be widened beyond the member's current value.
     *
     * @var array<string, array<string, list<bool|string>|'narrow'>>
     */
    public const RESTRICTING = [
        'api.v1.me.settings.update' => [
            'discoverable' => [false],
            'indexable' => [false],
            'show_owner_on_qr' => [false],
            'read_receipts' => [false],
            'ai_suggestions' => [false],
            'who_can_message' => 'narrow',
        ],
        'api.v1.vehicles.visibility' => [
            'visibility' => ['private'],
        ],
    ];

    /** who_can_message from the widest to the narrowest audience. */
    private const WHO_CAN_MESSAGE_ORDER = [WhoCanMessage::Everyone, WhoCanMessage::Following, WhoCanMessage::Nobody];

    public function __construct(private readonly Consents $consents) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (in_array($request->getMethod(), ['GET', 'HEAD', 'OPTIONS'], true) || in_array($request->route()?->getName(), self::EXEMPT, true)) {
            return $next($request);
        }

        $user = $request->user();

        if ($user instanceof User && $user->isPendingTerms()) {
            if (in_array($request->route()?->getName(), self::PENDING_TERMS_EXEMPT, true)) {
                return $next($request);
            }

            SetLocaleFromHeader::apply($request);

            throw new ApiException(ErrorCode::TermsRequired);
        }

        if ($user instanceof User && ! $this->restrictsOnly($request, $user) && $this->consents->outstanding($user)) {
            // Ahead of SetLocaleFromHeader (priority after authentication): the message is built now, in the request's language.
            SetLocaleFromHeader::apply($request);

            throw new ApiException(ErrorCode::ConsentRequired);
        }

        return $next($request);
    }

    /** Whether the request is a RESTRICTING route and every key it sends (at least one) only restricts. */
    private function restrictsOnly(Request $request, User $user): bool
    {
        $allowed = self::RESTRICTING[$request->route()?->getName() ?? ''] ?? null;
        // all(): body, query string and files, exactly what the FormRequest validates.
        $payload = $allowed === null ? [] : $request->all();

        if ($allowed === null || $payload === []) {
            return false;
        }

        foreach ($payload as $key => $value) {
            $rule = $allowed[$key] ?? null;

            if ($rule === null) {
                return false;
            }

            if ($rule === 'narrow') {
                if (! $this->narrows($value, $user)) {
                    return false;
                }

                continue;
            }

            if (! in_array($value, $rule, true)) {
                return false;
            }
        }

        return true;
    }

    private function narrows(mixed $value, User $user): bool
    {
        $next = is_string($value) ? WhoCanMessage::tryFrom($value) : null;
        $current = $user->getAttribute('who_can_message');

        if ($next === null || ! $current instanceof WhoCanMessage) {
            return false;
        }

        return array_search($next, self::WHO_CAN_MESSAGE_ORDER, true) >= array_search($current, self::WHO_CAN_MESSAGE_ORDER, true);
    }
}
