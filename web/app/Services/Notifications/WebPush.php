<?php

namespace App\Services\Notifications;

use App\Models\PushSubscription;
use App\Models\User;
use App\Services\AppConfig\FeatureFlags;
use GuzzleHttp\Psr7\HttpFactory;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\MessageSentReport;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush as WebPushClient;
use Psr\Log\LoggerInterface;
use Throwable;

/**
 * Web Push of the member web (09 §8.13, ADR-452, ADR-456) through minishlink/web-push. Configured when the three VAPID values in env
 * are usable (speedclub.web_push); enabled when configured and the flag web_push is on. The callers (SendPushNotification,
 * SendMessagePush) decide types, switches and quiet hours exactly as for native push and only pick the web_push channel here.
 *
 * Payload (mobile/public/sw.js): {title, body, tag?, lang?, data: {url}}. The url is an /app route of this origin, so the service worker
 * opens the member web there. Push texts carry no emoji (§4.9); a message preview loses its emoji too.
 *
 * One request per browser, one after the other, each bounded by speedclub.web_push.timeout_seconds; a member has at most
 * max_per_member browsers, so a push job stays well inside its time limit. A 404 or 410 means the browser dropped the subscription:
 * the row goes at once. Other failures count up, and max_failures in a row remove it too (for instance after a VAPID key change).
 *
 * Logs never carry an endpoint, a key, a title or a body: only counts and exception classes (05_ARCHITECTURE §15).
 */
class WebPush
{
    /** An uncompressed P-256 point, base64url: 65 bytes. */
    private const PUBLIC_KEY_BYTES = 65;

    private const PRIVATE_KEY_BYTES = 32;

    /** What a push service accepts at most after encryption (4096) less the encryption overhead. */
    private const MAX_PAYLOAD_BYTES = 3000;

    public function __construct(private readonly WebPushHttp $http, private readonly FeatureFlags $flags) {}

    /**
     * The VAPID public key for app-config, or null while the server cannot send.
     */
    public function publicKey(): ?string
    {
        return $this->vapid()['publicKey'] ?? null;
    }

    public function configured(): bool
    {
        return $this->vapid() !== null;
    }

    public function enabled(): bool
    {
        return $this->configured() && $this->flags->enabled('web_push');
    }

    /** Whether the member has a browser to send to (and sending is on). */
    public function reaches(User $user): bool
    {
        return $this->enabled() && PushSubscription::query()->where('user_id', $user->id)->exists();
    }

    /**
     * Sends one notification to each subscription. Returns how many push services accepted it.
     *
     * @param  iterable<PushSubscription>  $subscriptions
     * @param  string  $url  a path of the app ("/garage/…") or an /app route
     * @param  'very-low'|'low'|'normal'|'high'  $urgency
     */
    public function send(iterable $subscriptions, string $title, string $body, string $url, ?string $tag = null, ?string $lang = null, string $urgency = 'normal'): int
    {
        $vapid = $this->vapid();

        if ($vapid === null || ! $this->flags->enabled('web_push')) {
            return 0;
        }

        $payload = self::payload($title, $body, $url, $tag, $lang);
        $client = $this->client($vapid);
        $options = ['TTL' => config()->integer('speedclub.web_push.ttl_seconds'), 'urgency' => $urgency];
        $delivered = 0;
        $failed = 0;

        foreach ($subscriptions as $subscription) {
            try {
                $report = $client->sendOneNotification(new Subscription(
                    $subscription->endpoint,
                    $subscription->public_key,
                    $subscription->auth_token,
                    $subscription->content_encoding,
                ), $payload, $options);
            } catch (Throwable $exception) {
                Log::warning('Web push could not be prepared.', ['type' => $exception::class]);
                $this->failed($subscription);
                $failed++;

                continue;
            }

            if ($this->settle($subscription, $report)) {
                $delivered++;
            } else {
                $failed++;
            }
        }

        if ($failed > 0) {
            Log::info('Web push failures.', ['failed' => $failed, 'delivered' => $delivered]);
        }

        return $delivered;
    }

    /**
     * The JSON the service worker reads. A path of the app becomes its /app route; a public link (/v/…, /u/…) does too, so the
     * notification opens the member web directly. Anything that is not a path of this origin opens the app's start.
     */
    public static function payload(string $title, string $body, string $url, ?string $tag = null, ?string $lang = null): string
    {
        $title = self::plain($title);
        $body = self::plain($body);
        $route = self::route($url);

        $data = array_filter([
            'title' => $title === '' ? 'SPEED CLUB' : $title,
            'body' => $body,
            'tag' => $tag === null ? null : mb_substr($tag, 0, 64),
            'lang' => $lang,
            'data' => ['url' => $route],
        ], fn (mixed $value): bool => $value !== null);

        $json = (string) json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);

        // JSON escapes some characters, so the cut repeats until the payload fits (the title, tag and route are short).
        while (strlen($json) > self::MAX_PAYLOAD_BYTES && $data['body'] !== '') {
            $data['body'] = mb_strcut($data['body'], 0, max(0, strlen($data['body']) - max(1, strlen($json) - self::MAX_PAYLOAD_BYTES)), 'UTF-8');
            $json = (string) json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
        }

        return $json;
    }

    /**
     * "/garage/01…/maintenance?item=…" → "/app/garage/01…/maintenance?item=…". An /app route stays. Only a single-slash path of
     * this origin counts; "//host", a scheme or anything else becomes "/app/".
     */
    public static function route(string $url): string
    {
        if (! str_starts_with($url, '/') || str_starts_with($url, '//') || str_contains($url, '\\')) {
            return '/app/';
        }

        if ($url === '/app' || str_starts_with($url, '/app/') || str_starts_with($url, '/app?')) {
            return $url;
        }

        return '/app'.$url;
    }

    /**
     * Text without emoji (09 §4.9: push texts carry none), with single spaces. ©, ® and ™ are no emoji here.
     */
    public static function plain(string $text): string
    {
        $stripped = (string) preg_replace('/(?![\x{00A9}\x{00AE}\x{2122}])[\p{Extended_Pictographic}\p{Emoji_Modifier}\x{FE0F}\x{200D}\x{20E3}\x{1F1E6}-\x{1F1FF}]/u', '', $text);

        return trim((string) preg_replace('/\s+/u', ' ', $stripped));
    }

    /**
     * Whether an endpoint belongs to a browser vendor's push service (speedclub.web_push.hosts, the host itself or a subdomain), over
     * HTTPS on the default port. The server posts to it, so nothing else may be stored.
     */
    public static function allowedEndpoint(string $endpoint): bool
    {
        $parts = parse_url($endpoint);

        if (! is_array($parts) || ($parts['scheme'] ?? null) !== 'https' || ! is_string($parts['host'] ?? null)
            || isset($parts['user']) || isset($parts['pass']) || (isset($parts['port']) && $parts['port'] !== 443)) {
            return false;
        }

        $host = strtolower($parts['host']);
        /** @var list<string> $allowed */
        $allowed = config('speedclub.web_push.hosts');

        foreach ($allowed as $suffix) {
            $suffix = strtolower($suffix);

            if ($host === $suffix || str_ends_with($host, '.'.$suffix)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array{subject: string, publicKey: string, privateKey: string}|null
     */
    private function vapid(): ?array
    {
        $public = config('speedclub.web_push.public_key');
        $private = config('speedclub.web_push.private_key');
        $subject = config('speedclub.web_push.subject');

        if (! is_string($public) || ! is_string($private) || ! is_string($subject)) {
            return null;
        }

        [$public, $private, $subject] = [trim($public), trim($private), trim($subject)];

        if (strlen(self::decode($public)) !== self::PUBLIC_KEY_BYTES || strlen(self::decode($private)) !== self::PRIVATE_KEY_BYTES
            || (! str_starts_with($subject, 'mailto:') && ! str_starts_with($subject, 'https://'))) {
            return null;
        }

        return ['subject' => $subject, 'publicKey' => $public, 'privateKey' => $private];
    }

    private static function decode(string $base64url): string
    {
        if (preg_match('/\A[A-Za-z0-9_-]+={0,2}\z/', $base64url) !== 1) {
            return '';
        }

        return (string) base64_decode(strtr($base64url, '-_', '+/'), true);
    }

    /**
     * @param  array{subject: string, publicKey: string, privateKey: string}  $vapid
     */
    private function client(array $vapid): WebPushClient
    {
        $factory = new HttpFactory;
        /** @var LoggerInterface $logger */
        $logger = Log::channel();

        // The logger keeps the library's requirement notices out of trigger_error, which Laravel would turn into an exception.
        return new WebPushClient(['VAPID' => $vapid], [], $this->http->client(), $factory, $factory, null, $logger);
    }

    /**
     * Records what the push service said. True when it took the notification.
     */
    private function settle(PushSubscription $subscription, MessageSentReport $report): bool
    {
        if ($report->isSuccess()) {
            PushSubscription::query()->whereKey($subscription->id)->toBase()->update(['failures' => 0, 'last_used_at' => Carbon::now()]);

            return true;
        }

        if ($report->isSubscriptionExpired()) {
            PushSubscription::query()->whereKey($subscription->id)->delete();

            return false;
        }

        $this->failed($subscription);

        return false;
    }

    private function failed(PushSubscription $subscription): void
    {
        $failures = $subscription->failures + 1;

        if ($failures >= config()->integer('speedclub.web_push.max_failures')) {
            PushSubscription::query()->whereKey($subscription->id)->delete();

            return;
        }

        PushSubscription::query()->whereKey($subscription->id)->toBase()->update(['failures' => $failures]);
        $subscription->failures = $failures;
    }
}
