<?php

namespace App\Http;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Middleware\SetLocaleFromHeader;
use App\Services\Rules\RateLimitOverrides;
use App\Support\ClientAddress;
use App\Support\Viewer;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Symfony\Component\HttpFoundation\Response;

/**
 * Named limiters of 02_PRODUCT_SPEC §8: use as throttle:member-login, throttle:uploads and so on (the plain name
 * "login" belongs to the staff login through Fortify). The numbers live in
 * config/speedclub.php, the messages in lang/{de,en}/rate_limits.php. The verification-code limit of 5 attempts per
 * code is verification_codes.attempts, and the per-account login delay is App\Services\Auth\LoginThrottle.
 *
 * Client keys are ClientAddress::key(): an IPv6 client counts by its /64 (M3.1).
 */
final class RateLimits
{
    private const PER_IP = ['member_register', 'member_login', 'member_verify', 'member_email', 'qr', 'public_read', 'two_factor_challenge', 'contact_form', 'web_account_deletion'];

    private const PER_MEMBER_OR_IP = [
        'conversations', 'conversation_requests', 'messages', 'conversation_edits', 'typing', 'realtime_auth', 'follows', 'uploads', 'reports', 'catalog_requests', 'username_check', 'garage_writes', 'garage_reorders', 'garage_edits', 'unfollows', 'blocks', 'saves', 'account_edits', 'notification_reads', 'push_tokens', 'qr_downloads', 'qr_reissues', 'token_rotate', 'account_security', 'support_tickets', 'appeals',
        // M3.7 [AI]: throttle:ai (every AI endpoint but the translation) and throttle:ai-translate, per member and hour.
        'ai', 'ai_translate',
    ];

    /**
     * On routes that take guests and members alike, where no auth middleware sets the user: the member behind a token or a session
     * cookie (App\Support\Viewer), otherwise the IP. Search counts per member and per guest IP (02_PRODUCT_SPEC §8). Home, Discover
     * and search also carry throttle:browse, the same per member or guest IP. Both have an ip_max that keeps one address bounded
     * across all accounts behind it; search's is far lower, as a search is the most expensive read.
     */
    private const PER_VIEWER_OR_IP = ['search', 'browse'];

    /**
     * Every limiter this class defines (M3.4: the ones ADM-23 can override).
     *
     * @return list<string>
     */
    public static function names(): array
    {
        return [...self::PER_VIEWER_OR_IP, ...self::PER_IP, ...self::PER_MEMBER_OR_IP];
    }

    public static function register(): void
    {
        foreach (self::PER_VIEWER_OR_IP as $name) {
            self::define($name, function (Request $request): string {
                $viewer = Viewer::from($request);

                return $viewer === null ? 'ip:'.ClientAddress::key($request) : 'user:'.$viewer->id;
            }, config()->integer("speedclub.rate_limits.$name.ip_max", 0));
        }

        foreach (self::PER_IP as $name) {
            self::define($name, fn (Request $request): string => 'ip:'.ClientAddress::key($request));
        }

        foreach (self::PER_MEMBER_OR_IP as $name) {
            self::define($name, function (Request $request): string {
                $id = $request->user()?->getAuthIdentifier();

                return is_string($id) ? 'user:'.$id : 'ip:'.ClientAddress::key($request);
            });
        }
    }

    /**
     * Friendly {message, code, errors} for 429, with Retry-After in the headers.
     *
     * @param  array<string, int|string>  $headers
     */
    public static function tooMany(string $name, array $headers): ApiException
    {
        $seconds = isset($headers['Retry-After']) ? max(1, (int) $headers['Retry-After']) : 60;

        return new ApiException(
            ErrorCode::RateLimited,
            (string) __('rate_limits.'.$name, ['time' => self::humanTime($seconds)]),
            headers: array_map(strval(...), $headers),
        );
    }

    /**
     * @param  callable(Request): string  $key
     * @param  int  $ipMax  above 0: a second limit per IP over everybody behind it, members and guests together
     */
    private static function define(string $name, callable $key, int $ipMax = 0): void
    {
        $max = config()->integer("speedclub.rate_limits.$name.max");
        // M3.4 (ADM-23): the override of the published config version, bounded to 0.25×–4× of the default. Read at boot from the
        // RateLimitOverrides memo, so all limiters share one cache read per process (MF-2) and every request costs the same queries.
        $max = RateLimitOverrides::maxFor($name, $max) ?? $max;
        $minutes = config()->integer("speedclub.rate_limits.$name.minutes");

        // Limiter names use dashes in routes: throttle:conversation-requests.
        RateLimiter::for(str_replace('_', '-', $name), function (Request $request) use ($name, $key, $max, $minutes, $ipMax): Limit|array {
            $limit = self::respond($name, (new Limit('', $max, $minutes * 60))->by($name.'|'.$key($request)));

            // Its own key, also for a guest whose first key is the same IP: one counter per limit.
            return $ipMax > 0
                ? [$limit, self::respond($name, (new Limit('', $ipMax, $minutes * 60))->by($name.'|address|ip:'.ClientAddress::key($request)))]
                : $limit;
        });
    }

    private static function respond(string $name, Limit $limit): Limit
    {
        return $limit->response(function (Request $request, array $headers) use ($name): Response {
            // Throttling runs ahead of the locale middleware.
            SetLocaleFromHeader::apply($request);

            /** @var array<string, int|string> $headers */
            $tooMany = self::tooMany($name, $headers);

            // Somebody who scanned a sticker gets a page, not JSON and not an error 500.
            if (! $request->is('api', 'api/*')) {
                return response()->view('public.state', ['state' => 'rate_limited', 'body' => $tooMany->getMessage()], 429, $tooMany->headers);
            }

            throw $tooMany;
        });
    }

    private static function humanTime(int $seconds): string
    {
        return match (true) {
            $seconds < 60 => trans_choice('rate_limits.time.seconds', $seconds, ['count' => $seconds]),
            $seconds < 3600 => trans_choice('rate_limits.time.minutes', (int) ceil($seconds / 60), ['count' => (int) ceil($seconds / 60)]),
            default => trans_choice('rate_limits.time.hours', (int) ceil($seconds / 3600), ['count' => (int) ceil($seconds / 3600)]),
        };
    }
}
