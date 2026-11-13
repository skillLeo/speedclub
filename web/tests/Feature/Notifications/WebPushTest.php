<?php

use App\Actions\Auth\LogoutMember;
use App\Actions\Notifications\RegisterPushSubscription;
use App\Enums\RestrictionType;
use App\Http\RateLimits;
use App\Models\FeatureFlag;
use App\Models\PushSubscription;
use App\Models\Staff;
use App\Models\User;
use App\Services\AppConfig\FeatureFlags;
use App\Services\Auth\DeviceSessions;
use App\Services\Auth\MemberSessions;
use App\Services\Notifications\Notifier;
use App\Services\Notifications\SendPushNotification;
use App\Services\Notifications\WebPush;
use App\Services\Notifications\WebPushHttp;
use Carbon\CarbonImmutable;
use Database\Factories\PushSubscriptionFactory;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;
use Minishlink\WebPush\VAPID;
use Psr\Http\Client\ClientInterface;
use Psr\Http\Message\RequestInterface;

require_once __DIR__.'/NotificationTestHelpers.php';
require_once dirname(__DIR__).'/Messaging/MessagingTestHelpers.php';
require_once dirname(__DIR__).'/Settings/SettingsTestHelpers.php';

/**
 * M4.15 Web Push (09 §8.13, ADR-452, ADR-456): POST/DELETE me/push-subscriptions, app-config's public key, delivery through
 * minishlink/web-push from the push jobs (switches, quiet hours, 404/410), the key command and the inline queue of shared hosts.
 * Never the network: the PSR-18 client is Guzzle with a MockHandler.
 */
const WP_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/eQ1kZ9-test-endpoint:APA91bH-abcdefghijklmnop';

beforeEach(function () {
    Mail::fake();
    Http::preventStrayRequests();
    $keys = VAPID::createVapidKeys();
    config([
        'speedclub.web_push.public_key' => $keys['publicKey'],
        'speedclub.web_push.private_key' => $keys['privateKey'],
        'speedclub.web_push.subject' => 'mailto:support@speedclub.de',
    ]);
    FeatureFlag::query()->updateOrCreate(['key' => 'web_push'], ['enabled' => true]);
    $this->member = ntfMember('lena.911');
});

/**
 * The push services answer with $responses, in order; the returned object records each request.
 *
 * @return object{calls: array<int, array{request: RequestInterface}>}
 */
function wpFake(Response ...$responses): object
{
    $recorder = new class
    {
        /** @var array<int, array{request: RequestInterface}> */
        public array $calls = [];
    };
    $stack = HandlerStack::create(new MockHandler($responses));
    $stack->push(Middleware::history($recorder->calls));

    app()->instance(WebPushHttp::class, new class($stack) extends WebPushHttp
    {
        public function __construct(private readonly HandlerStack $stack) {}

        public function client(): ClientInterface
        {
            return new Client(['handler' => $this->stack, 'http_errors' => false, 'allow_redirects' => false]);
        }
    });

    return $recorder;
}

/**
 * WebPush with send() recorded instead of sent, for what the jobs hand over.
 *
 * @return object{sent: list<array<string, mixed>>}
 */
function wpSpy(): object
{
    $spy = new class(app(WebPushHttp::class), app(FeatureFlags::class)) extends WebPush
    {
        /** @var list<array<string, mixed>> */
        public array $sent = [];

        public function send(iterable $subscriptions, string $title, string $body, string $url, ?string $tag = null, ?string $lang = null, string $urgency = 'normal'): int
        {
            $ids = [];

            foreach ($subscriptions as $subscription) {
                $ids[] = $subscription->id;
            }

            $this->sent[] = compact('ids', 'title', 'body', 'url', 'tag', 'lang', 'urgency');

            return count($ids);
        }
    };
    app()->instance(WebPush::class, $spy);

    return $spy;
}

/**
 * Runs $setup with Web Push off (no private key), so the follow and the first message it makes push nothing and start no cooldown.
 */
function wpQuietly(Closure $setup): mixed
{
    $key = config('speedclub.web_push.private_key');
    config(['speedclub.web_push.private_key' => null]);

    try {
        return $setup();
    } finally {
        config(['speedclub.web_push.private_key' => $key]);
    }
}

function wpBody(array $overrides = []): array
{
    return array_replace_recursive([
        'endpoint' => WP_ENDPOINT,
        'keys' => [
            'p256dh' => PushSubscriptionFactory::base64url(PushSubscriptionFactory::p256Point()),
            'auth' => PushSubscriptionFactory::base64url(random_bytes(16)),
        ],
        'user_agent' => 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0',
    ], $overrides);
}

function wpSubscribe(array $body = [], array $headers = []): mixed
{
    return test()->postJson('/api/v1/me/push-subscriptions', wpBody($body), $headers);
}

describe('POST me/push-subscriptions', function () {
    it('stores the subscription with endpoint and keys encrypted at rest, once per endpoint', function () {
        Sanctum::actingAs($this->member);
        $body = wpBody();

        $this->postJson('/api/v1/me/push-subscriptions', $body)->assertNoContent();
        $this->postJson('/api/v1/me/push-subscriptions', $body)->assertNoContent();

        $row = PushSubscription::query()->sole();
        $raw = DB::table('push_subscriptions')->sole();

        expect($row->user_id)->toBe($this->member->id)
            ->and($row->endpoint)->toBe(WP_ENDPOINT)
            ->and($row->public_key)->toBe($body['keys']['p256dh'])
            ->and($row->auth_token)->toBe($body['keys']['auth'])
            ->and($row->browser)->toBe('Chrome, Linux')
            ->and((array) $raw)->not->toHaveKey('user_agent')
            ->and($raw->endpoint_hash)->toBe(hash('sha256', WP_ENDPOINT))
            ->and($raw->endpoint)->not->toContain('fcm.googleapis.com')
            ->and($raw->public_key)->not->toBe($body['keys']['p256dh'])
            ->and($raw->auth_token)->not->toBe($body['keys']['auth']);
    });

    it('moves an endpoint to the member who subscribed on that browser last, with the new keys and no failures', function () {
        $before = ntfMember('lukas.sc');
        PushSubscription::factory()->endpoint(WP_ENDPOINT)->create(['user_id' => $before->id, 'failures' => 3]);
        Sanctum::actingAs($this->member);
        $body = wpBody();

        wpSubscribe($body)->assertNoContent();

        $row = PushSubscription::query()->sole();
        expect($row->user_id)->toBe($this->member->id)
            ->and($row->auth_token)->toBe($body['keys']['auth'])
            ->and($row->failures)->toBe(0);
    });

    it('keeps the newest browsers of a member up to the limit', function () {
        config(['speedclub.web_push.max_per_member' => 2]);
        $old = PushSubscription::factory()->create(['user_id' => $this->member->id, 'updated_at' => now()->subDays(3)]);
        $recent = PushSubscription::factory()->create(['user_id' => $this->member->id, 'updated_at' => now()->subDay()]);
        $other = PushSubscription::factory()->create(['updated_at' => now()->subDays(9)]);
        Sanctum::actingAs($this->member);

        wpSubscribe()->assertNoContent();

        expect(PushSubscription::query()->whereKey($old->id)->exists())->toBeFalse()
            ->and(PushSubscription::query()->whereKey($recent->id)->exists())->toBeTrue()
            ->and(PushSubscription::query()->whereKey($other->id)->exists())->toBeTrue()
            ->and(PushSubscription::query()->where('user_id', $this->member->id)->count())->toBe(2);
    });

    it('takes only push service endpoints and keys of the right size', function (array $body, string $field) {
        Sanctum::actingAs($this->member);

        wpSubscribe($body)->assertUnprocessable()->assertJsonValidationErrors($field);
        expect(PushSubscription::query()->count())->toBe(0);
    })->with([
        'no endpoint' => [['endpoint' => ''], 'endpoint'],
        'plain http' => [['endpoint' => 'http://fcm.googleapis.com/fcm/send/abc'], 'endpoint'],
        'own host' => [['endpoint' => 'https://speedclub.de/api/v1/me'], 'endpoint'],
        'internal address' => [['endpoint' => 'https://169.254.169.254/latest/meta-data'], 'endpoint'],
        'look-alike host' => [['endpoint' => 'https://fcm.googleapis.com.evil.example/send/abc'], 'endpoint'],
        'suffix without dot' => [['endpoint' => 'https://evilpush.apple.com.example/x'], 'endpoint'],
        'other port' => [['endpoint' => 'https://fcm.googleapis.com:8443/fcm/send/abc'], 'endpoint'],
        'credentials' => [['endpoint' => 'https://user:pw@fcm.googleapis.com/fcm/send/abc'], 'endpoint'],
        'too long' => [['endpoint' => WP_ENDPOINT.str_repeat('a', 2100)], 'endpoint'],
        'short p256dh' => [['keys' => ['p256dh' => PushSubscriptionFactory::base64url(random_bytes(32))]], 'keys.p256dh'],
        'p256dh not a point' => [['keys' => ['p256dh' => PushSubscriptionFactory::base64url("\x02".random_bytes(64))]], 'keys.p256dh'],
        'p256dh not base64url' => [['keys' => ['p256dh' => str_repeat('*', 87)]], 'keys.p256dh'],
        'auth of 8 bytes' => [['keys' => ['auth' => PushSubscriptionFactory::base64url(random_bytes(8))]], 'keys.auth'],
        'user agent too long' => [['user_agent' => str_repeat('a', 256)], 'user_agent'],
    ]);

    it('accepts the endpoints of Firefox, Safari and Edge', function (string $endpoint) {
        Sanctum::actingAs($this->member);

        wpSubscribe(['endpoint' => $endpoint])->assertNoContent();
    })->with([
        'Firefox' => 'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk-abc',
        'Safari' => 'https://web.push.apple.com/QGuQyavXutnMH-abc',
        'Edge' => 'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB-abc',
    ]);

    it('answers 404 feature_disabled while the flag is off', function () {
        FeatureFlag::query()->where('key', 'web_push')->update(['enabled' => false]);
        Sanctum::actingAs($this->member);

        wpSubscribe()->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    });

    it('replays with the same Idempotency-Key', function () {
        Sanctum::actingAs($this->member);
        $body = wpBody();

        $this->postJson('/api/v1/me/push-subscriptions', $body, ['Idempotency-Key' => 'wp-1'])->assertNoContent();
        $this->postJson('/api/v1/me/push-subscriptions', $body, ['Idempotency-Key' => 'wp-1'])->assertNoContent();

        expect(PushSubscription::query()->count())->toBe(1);
    });

    it('is limited', function () {
        config(['speedclub.rate_limits.push_tokens.max' => 1]);
        RateLimits::register();
        Sanctum::actingAs($this->member);

        wpSubscribe()->assertNoContent();
        wpSubscribe()->assertStatus(429)->assertJsonPath('code', 'rate_limited');
    });

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        $who();

        wpSubscribe()->assertStatus($status);
    })->with([
        'guest' => [fn () => null, 401],
        'member' => [fn () => Sanctum::actingAs(User::factory()->create()), 204],
        'unverified member' => [fn () => Sanctum::actingAs(User::factory()->unverified()->create()), 204],
        'member restricted from messaging' => [fn () => Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Messaging)->create()), 204],
        'suspended member' => [fn () => Sanctum::actingAs(User::factory()->suspended()->create()), 204],
        'deactivated member' => [fn () => Sanctum::actingAs(User::factory()->deactivated()->create()), 403],
        'staff' => [fn () => test()->actingAs(Staff::factory()->create(), 'staff'), 401],
    ]);
});

describe('DELETE me/push-subscriptions', function () {
    it('removes the member\'s subscription of that endpoint only, and an unknown or foreign endpoint is no error', function () {
        $other = ntfMember('lukas.sc');
        PushSubscription::factory()->endpoint(WP_ENDPOINT)->create(['user_id' => $this->member->id]);
        $kept = PushSubscription::factory()->create(['user_id' => $this->member->id]);
        $foreign = PushSubscription::factory()->endpoint(WP_ENDPOINT.'-b')->create(['user_id' => $other->id]);
        Sanctum::actingAs($this->member);

        $this->deleteJson('/api/v1/me/push-subscriptions', ['endpoint' => WP_ENDPOINT])->assertNoContent();
        $this->deleteJson('/api/v1/me/push-subscriptions', ['endpoint' => WP_ENDPOINT.'-b'])->assertNoContent();
        $this->deleteJson('/api/v1/me/push-subscriptions', ['endpoint' => 'https://fcm.googleapis.com/fcm/send/nichts-da'])->assertNoContent();

        expect(PushSubscription::query()->pluck('id')->sort()->values()->all())->toBe(collect([$kept->id, $foreign->id])->sort()->values()->all());
    });

    it('stays open while the flag is off, so a browser can clean up', function () {
        FeatureFlag::query()->where('key', 'web_push')->update(['enabled' => false]);
        PushSubscription::factory()->endpoint(WP_ENDPOINT)->create(['user_id' => $this->member->id]);
        Sanctum::actingAs($this->member);

        $this->deleteJson('/api/v1/me/push-subscriptions', ['endpoint' => WP_ENDPOINT])->assertNoContent();

        expect(PushSubscription::query()->count())->toBe(0);
    });

    it('needs the endpoint', function () {
        Sanctum::actingAs($this->member);

        $this->deleteJson('/api/v1/me/push-subscriptions', [])->assertUnprocessable()->assertJsonValidationErrors('endpoint');
    });

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        $who();

        $this->deleteJson('/api/v1/me/push-subscriptions', ['endpoint' => WP_ENDPOINT])->assertStatus($status);
    })->with([
        'guest' => [fn () => null, 401],
        'member' => [fn () => Sanctum::actingAs(User::factory()->create()), 204],
        'suspended member' => [fn () => Sanctum::actingAs(User::factory()->suspended()->create()), 204],
        'deactivated member' => [fn () => Sanctum::actingAs(User::factory()->deactivated()->create()), 403],
        'staff' => [fn () => test()->actingAs(Staff::factory()->create(), 'staff'), 401],
    ]);
});

describe('app-config web_push', function () {
    it('gives the VAPID public key, never the private key', function () {
        $response = $this->getJson('/api/v1/app-config')->assertOk();

        expect($response->json('data.web_push'))->toBe(['vapid_public_key' => config('speedclub.web_push.public_key')])
            ->and($response->getContent())->not->toContain((string) config('speedclub.web_push.private_key'));
    });

    it('is null without usable keys', function (array $config) {
        config($config);

        $this->getJson('/api/v1/app-config')->assertOk()->assertJsonPath('data.web_push', ['vapid_public_key' => null]);
    })->with([
        'no keys' => [['speedclub.web_push.public_key' => null, 'speedclub.web_push.private_key' => null]],
        'no subject' => [['speedclub.web_push.subject' => null]],
        'subject not mailto or https' => [['speedclub.web_push.subject' => 'support@speedclub.de']],
        'short public key' => [['speedclub.web_push.public_key' => 'abc']],
        'private key missing' => [['speedclub.web_push.private_key' => '']],
    ]);
});

describe('delivery', function () {
    beforeEach(function () {
        config(['speedclub.push.enabled' => false]);
        // Noon in Berlin: outside the default quiet hours.
        $this->travelTo(CarbonImmutable::parse('2026-11-08 12:00', 'Europe/Berlin'));
        $this->subscription = PushSubscription::factory()->endpoint(WP_ENDPOINT)->create(['user_id' => $this->member->id]);
    });

    it('sends a notification row to the member\'s browsers with VAPID, TTL and an encrypted body', function () {
        $recorder = wpFake(new Response(201));

        app(Notifier::class)->newFollower($this->member, ntfMember('lukas.sc'));

        expect($recorder->calls)->toHaveCount(1);
        $request = $recorder->calls[0]['request'];
        expect((string) $request->getUri())->toBe(WP_ENDPOINT)
            ->and($request->getMethod())->toBe('POST')
            ->and($request->getHeaderLine('Authorization'))->toStartWith('vapid t=')
            ->and($request->getHeaderLine('Authorization'))->toContain('k='.config('speedclub.web_push.public_key'))
            ->and($request->getHeaderLine('Content-Encoding'))->toBe('aes128gcm')
            ->and($request->getHeaderLine('TTL'))->toBe((string) config('speedclub.web_push.ttl_seconds'))
            ->and($request->getHeaderLine('Urgency'))->toBe('normal')
            ->and((string) $request->getBody())->not->toContain('lukas.sc')
            ->and($this->subscription->fresh()?->last_used_at)->not->toBeNull();
    });

    it('hands the job\'s text, the /app route, a tag per row and the member\'s language to WebPush', function () {
        $spy = wpSpy();

        $row = app(Notifier::class)->newFollower($this->member, ntfMember('lukas.sc'));

        expect($spy->sent)->toHaveCount(1)
            ->and($spy->sent[0]['ids'])->toBe([$this->subscription->id])
            ->and($spy->sent[0]['body'])->toContain('@lukas.sc')
            ->and($spy->sent[0]['url'])->toBe('/u/lukas.sc')
            ->and($spy->sent[0]['tag'])->toBe('ntf-'.$row?->id)
            ->and($spy->sent[0]['lang'])->toBe('de');
    });

    it('follows the type\'s web_push switch, not its push switch', function () {
        $spy = wpSpy();
        $this->member->forceFill(['notification_prefs' => ['types' => ['new_follower' => ['push' => true, 'web_push' => false]]]])->save();

        app(Notifier::class)->newFollower($this->member, ntfMember('lukas.sc'));
        expect($spy->sent)->toBe([]);

        $other = ntfMember('mia.golf', ['notification_prefs' => ['types' => ['new_follower' => ['push' => false, 'web_push' => true]]]]);
        PushSubscription::factory()->create(['user_id' => $other->id]);
        app(Notifier::class)->newFollower($other, ntfMember('paul.roadster'));

        expect($spy->sent)->toHaveCount(1);
    });

    it('stays silent in quiet hours, and while the flag or the keys are missing', function (Closure $setup) {
        Queue::fake();
        $setup();

        app(Notifier::class)->newFollower($this->member, ntfMember('lukas.sc'));

        Queue::assertNotPushed(SendPushNotification::class);
    })->with([
        'quiet hours' => [fn () => test()->travelTo(CarbonImmutable::parse('2026-11-08 23:30', 'Europe/Berlin'))],
        'flag off' => [fn () => FeatureFlag::query()->where('key', 'web_push')->update(['enabled' => false])],
        'no keys' => [fn () => config(['speedclub.web_push.private_key' => null])],
        'no browser' => [fn () => PushSubscription::query()->delete()],
    ]);

    it('decides again when the job runs: quiet hours by then send nothing', function () {
        Queue::fake();
        $row = app(Notifier::class)->newFollower($this->member, ntfMember('lukas.sc'));
        Queue::assertPushed(SendPushNotification::class);
        $recorder = wpFake();

        $this->travelTo(CarbonImmutable::parse('2026-11-08 22:30', 'Europe/Berlin'));
        dispatch_sync(new SendPushNotification((string) $row?->id));

        expect($recorder->calls)->toBe([]);
    });

    it('drops a subscription the browser gave up (404, 410) at once', function (int $status) {
        wpFake(new Response($status));

        app(Notifier::class)->newFollower($this->member, ntfMember('lukas.sc'));

        expect(PushSubscription::query()->whereKey($this->subscription->id)->exists())->toBeFalse();
    })->with([404, 410]);

    it('counts other failures and drops the subscription after max_failures in a row; a success resets the count', function () {
        config(['speedclub.web_push.max_failures' => 2]);
        wpFake(new Response(500), new Response(201));
        $send = fn () => app(WebPush::class)->send([$this->subscription->fresh()], 'SPEED CLUB', 'Text', '/notifications');

        expect($send())->toBe(0)
            ->and($this->subscription->fresh()?->failures)->toBe(1)
            ->and($send())->toBe(1)
            ->and($this->subscription->fresh()?->failures)->toBe(0);

        wpFake(new Response(403), new Response(429));
        $send();
        $send();

        expect(PushSubscription::query()->whereKey($this->subscription->id)->exists())->toBeFalse();
    });

    it('logs no endpoint and no text when a push service fails', function () {
        $logged = [];
        Log::listen(function ($message) use (&$logged): void {
            $logged[] = $message->message.json_encode($message->context);
        });
        wpFake(new Response(500));

        app(WebPush::class)->send([$this->subscription], 'SPEED CLUB', 'Geheimer Text', '/notifications');

        expect(implode("\n", $logged))->not->toContain('fcm.googleapis.com')->not->toContain('Geheimer Text');
    });

    it('pushes a message to the browsers under new_message\'s web_push switch, tagged per conversation', function () {
        $jann = ntfMember('jann.ptrs');
        $id = wpQuietly(fn () => msgStart($jann, $this->member)->conversation_id);
        $spy = wpSpy();
        msgActAs($jann);

        $this->postJson("/api/v1/conversations/$id/messages", ['type' => 'text', 'body' => 'Streng geheim: 7731', 'client_id' => (string) Str::uuid()])->assertCreated();

        expect($spy->sent)->toHaveCount(1)
            ->and($spy->sent[0]['body'])->toBe('Neue Nachricht von @jann.ptrs')
            ->and($spy->sent[0]['url'])->toBe("/messages/$id")
            ->and($spy->sent[0]['tag'])->toBe("msg-$id")
            ->and(json_encode($spy->sent))->not->toContain('7731');
    });

    it('sends nothing for a message while the member switched web_push off for messages', function () {
        $this->member->forceFill(['notification_prefs' => ['types' => ['new_message' => ['web_push' => false]]]])->save();
        $jann = ntfMember('jann.ptrs');
        $id = wpQuietly(fn () => msgStart($jann, $this->member)->conversation_id);
        $spy = wpSpy();
        msgActAs($jann);

        $this->postJson("/api/v1/conversations/$id/messages", ['type' => 'text', 'body' => 'Hallo', 'client_id' => (string) Str::uuid()])->assertCreated();

        expect($spy->sent)->toBe([]);
    });

    it('works in the queue worker of speedclub:schedule-inline (shared hosts without proc_open)', function () {
        config(['queue.default' => 'database']);
        $recorder = wpFake(new Response(201));
        $this->travelTo(CarbonImmutable::parse('2026-11-10 12:01:00', 'Europe/Berlin'));

        app(Notifier::class)->newFollower($this->member, ntfMember('lukas.sc'));
        expect(DB::table('jobs')->count())->toBe(1)
            ->and($recorder->calls)->toBe([]);

        Artisan::call('speedclub:schedule-inline');

        expect(DB::table('jobs')->count())->toBe(0)
            ->and(DB::table('failed_jobs')->count())->toBe(0)
            ->and($recorder->calls)->toHaveCount(1);
    });
});

describe('payload', function () {
    it('is the service worker\'s shape with an /app route', function () {
        expect(json_decode(WebPush::payload('SPEED CLUB', '@lukas.sc folgt dir jetzt.', '/u/lukas.sc', 'ntf-1', 'de'), true))->toBe([
            'title' => 'SPEED CLUB',
            'body' => '@lukas.sc folgt dir jetzt.',
            'tag' => 'ntf-1',
            'lang' => 'de',
            'data' => ['url' => '/app/u/lukas.sc'],
        ])->and(json_decode(WebPush::payload('T', 'B', '/notifications'), true))->toBe(['title' => 'T', 'body' => 'B', 'data' => ['url' => '/app/notifications']]);
    });

    it('opens the app start for anything that is not a path of this origin', function (string $url, string $route) {
        expect(WebPush::route($url))->toBe($route);
    })->with([
        ['/app/garage/01H/maintenance?item=1', '/app/garage/01H/maintenance?item=1'],
        ['/settings/security/activity?event=01J', '/app/settings/security/activity?event=01J'],
        ['/app', '/app'],
        ['https://evil.example/x', '/app/'],
        ['//evil.example/x', '/app/'],
        ['/\\evil.example', '/app/'],
        ['', '/app/'],
    ]);

    it('carries no emoji and keeps within the size a push service takes', function () {
        $payload = json_decode(WebPush::payload('Neu 🚗', 'Hallo 👋🏽 Welt ❤️ © '.str_repeat('ä', 3000), '/x'), true);

        expect($payload['title'])->toBe('Neu')
            ->and($payload['body'])->toStartWith('Hallo Welt © ä')
            ->and(strlen(WebPush::payload('T', str_repeat('ä', 3000), '/x')))->toBeLessThanOrEqual(3000);
    });
});

describe('ending sign-ins and the data export', function () {
    it('drops every browser when all sign-ins end', function () {
        PushSubscription::factory()->count(2)->create(['user_id' => $this->member->id]);
        $other = PushSubscription::factory()->create();

        app(MemberSessions::class)->revokeAll($this->member);

        expect(PushSubscription::query()->pluck('id')->all())->toBe([$other->id]);
    });

    it('goes with the account', function () {
        PushSubscription::factory()->create(['user_id' => $this->member->id]);

        $this->member->forceDelete();

        expect(PushSubscription::query()->count())->toBe(0);
    });
});

describe('tied to the browser sign-in (SET-06)', function () {
    beforeEach(function () {
        config(['session.driver' => 'database']);
    });

    /**
     * A request of the member web: a cookie session with this id, no token.
     */
    function wpBrowserRequest(string $sessionId): Request
    {
        $session = app('session')->driver();
        $session->setId($sessionId);
        $request = Request::create('/api/v1/me/sessions', 'DELETE');
        $request->setLaravelSession($session);

        return $request;
    }

    function wpSubscribedIn(User $member, ?string $sessionId): PushSubscription
    {
        return app(RegisterPushSubscription::class)->handle($member, 'https://fcm.googleapis.com/fcm/send/'.Str::random(30), PushSubscriptionFactory::base64url(PushSubscriptionFactory::p256Point()), PushSubscriptionFactory::base64url(random_bytes(16)), null, $sessionId);
    }

    it('stores a hash of the member web session that subscribed, never the session id', function () {
        $here = Str::random(40);
        $row = wpSubscribedIn($this->member, $here);

        expect($row->fresh()?->session_key)->toBe(hash('sha256', $here))
            ->and(DB::table('push_subscriptions')->value('session_key'))->not->toBe($here)
            ->and(wpSubscribedIn($this->member, null)->fresh()?->session_key)->toBeNull();
    });

    it('takes the session of a cookie request from the member web', function () {
        $this->actingAs($this->member, 'web')
            // StatefulFrontendWithSession starts a session only for a browser that already has the cookie (SEC-105).
            ->withCredentials()
            ->withCookie(config()->string('session.cookie'), Str::random(40))
            ->withHeaders(['Referer' => 'http://localhost:8080/app/settings/notifications'])
            ->postJson('http://localhost:8080/api/v1/me/push-subscriptions', wpBody())
            ->assertNoContent();

        expect(PushSubscription::query()->sole()->session_key)->toMatch('/\A[0-9a-f]{64}\z/');
    });

    it('drops the browser SET-06 signs out, and only that one', function () {
        $here = setSignIn($this->member, 'install-here-0001');
        $gone = Str::random(40);
        $kept = Str::random(40);
        foreach ([$gone, $kept] as $id) {
            DB::table('sessions')->insert(['id' => $id, 'user_id' => $this->member->id, 'ip_address' => null, 'user_agent' => 'Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/133.0', 'payload' => base64_encode('a:0:{}'), 'last_activity' => now()->getTimestamp() - ($id === $gone ? 0 : 60)]);
        }
        $goneRow = wpSubscribedIn($this->member, $gone);
        $keptRow = wpSubscribedIn($this->member, $kept);

        // SET-06 lists browsers by last activity, newest first: the first web row is $gone.
        $browser = collect($this->withToken($here)->getJson('/api/v1/me/sessions')->json('data'))->where('kind', 'web')->first();
        $this->withToken($here)->deleteJson('/api/v1/me/sessions/'.$browser['id'])->assertNoContent();

        expect(DB::table('sessions')->where('id', $gone)->exists())->toBeFalse()
            ->and(PushSubscription::query()->whereKey($goneRow->id)->exists())->toBeFalse()
            ->and(PushSubscription::query()->whereKey($keptRow->id)->exists())->toBeTrue();
    });

    it('drops every other browser on "Alle anderen abmelden", and keeps this browser\'s', function () {
        $here = Str::random(40);
        $other = Str::random(40);
        $mine = wpSubscribedIn($this->member, $here);
        wpSubscribedIn($this->member, $other);
        wpSubscribedIn($this->member, null);
        $stranger = PushSubscription::factory()->create();

        app(DeviceSessions::class)->endOtherBrowsers($this->member, wpBrowserRequest($here));

        expect(PushSubscription::query()->pluck('id')->sort()->values()->all())->toBe(collect([$mine->id, $stranger->id])->sort()->values()->all());
    });

    it('drops all of them when the app signs out every other device', function () {
        $here = setSignIn($this->member, 'install-here-0001');
        wpSubscribedIn($this->member, Str::random(40));
        wpSubscribedIn($this->member, Str::random(40));

        $this->withToken($here)->deleteJson('/api/v1/me/sessions')->assertNoContent();

        expect(PushSubscription::query()->where('user_id', $this->member->id)->count())->toBe(0);
    });

    it('drops this browser\'s subscription at its sign-out, not the others', function () {
        $here = Str::random(40);
        wpSubscribedIn($this->member, $here);
        $other = wpSubscribedIn($this->member, Str::random(40));
        Auth::guard('web')->setUser($this->member);

        app(LogoutMember::class)->handle($this->member, wpBrowserRequest($here));

        expect(PushSubscription::query()->pluck('id')->all())->toBe([$other->id]);
    });
});

describe('MeResource locale', function () {
    it('says "system" for an account that follows the device language, as GET me/settings does', function () {
        $this->member->forceFill(['locale' => 'en', 'locale_follows_system' => true])->save();

        $this->postJson('/api/v1/auth/login', ['email' => $this->member->email, 'password' => 'password', 'device_name' => 'Pixel'])
            ->assertOk()->assertJsonPath('data.member.locale', 'system');

        $this->member->forceFill(['locale_follows_system' => false])->save();
        Sanctum::actingAs($this->member);
        $this->getJson('/api/v1/me/settings')->assertOk()->assertJsonPath('data.locale', 'en');
    });
});

describe('speedclub:web-push-keys', function () {
    it('prints a usable key pair and writes no file', function () {
        $env = base_path('.env');
        $before = is_file($env) ? hash_file('sha256', $env) : null;

        expect(Artisan::call('speedclub:web-push-keys'))->toBe(0);
        $output = Artisan::output();

        preg_match('/^WEB_PUSH_VAPID_PUBLIC_KEY=(\S+)$/m', $output, $public);
        preg_match('/^WEB_PUSH_VAPID_PRIVATE_KEY=(\S+)$/m', $output, $private);

        expect($public[1] ?? null)->toBeString()
            ->and(strlen(VAPID::validate(['subject' => 'mailto:support@speedclub.de', 'publicKey' => $public[1], 'privateKey' => $private[1]])['publicKey']))->toBe(65)
            ->and($output)->toContain('WEB_PUSH_VAPID_SUBJECT=mailto:')
            ->and(is_file($env) ? hash_file('sha256', $env) : null)->toBe($before);
    });
});
