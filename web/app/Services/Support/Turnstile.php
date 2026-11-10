<?php

namespace App\Services\Support;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Cloudflare Turnstile on the public forms (WEB-05, WEB-10), only when TURNSTILE_SITE_KEY and TURNSTILE_SECRET are set; without them
 * the forms rely on their rate limits (the documented fallback, docs/DEPLOY.md §10). The visitor's IP is not sent (remoteip is optional).
 *
 * A token counts only for the form it was solved on (SEC-P2-13): each widget names its action (data-action), and siteverify must
 * report that action and this site's host, so a token solved on another page or another site using the same key is refused.
 */
final class Turnstile
{
    public const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

    public const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

    public static function enabled(): bool
    {
        return self::siteKey() !== null && self::secret() !== null;
    }

    /** The widget actions, one per form; the Blade widget sets the same value in data-action. */
    public const ACTION_CONTACT = 'contact';

    public const ACTION_REPORT = 'report';

    public const ACTION_ACCOUNT_DELETION = 'account_deletion';

    public static function siteKey(): ?string
    {
        $key = config('speedclub.services.turnstile_site_key');

        return is_string($key) && $key !== '' ? $key : null;
    }

    /**
     * True when Turnstile is off or the token checks out. A Cloudflare outage fails closed: the form says to try again.
     */
    public function passes(?string $token, string $action): bool
    {
        if (! self::enabled()) {
            return true;
        }

        if ($token === null || $token === '' || strlen($token) > 2048) {
            return false;
        }

        try {
            $response = Http::asForm()->timeout(5)->post(self::VERIFY_URL, ['secret' => self::secret(), 'response' => $token]);

            return $response->successful()
                && $response->json('success') === true
                && $response->json('action') === $action
                && is_string($host = $response->json('hostname'))
                && strcasecmp($host, request()->getHost()) === 0;
        } catch (Throwable $exception) {
            Log::warning('Turnstile could not be reached.', ['type' => $exception::class]);

            return false;
        }
    }

    private static function secret(): ?string
    {
        $secret = config('speedclub.services.turnstile_secret');

        return is_string($secret) && $secret !== '' ? $secret : null;
    }
}
