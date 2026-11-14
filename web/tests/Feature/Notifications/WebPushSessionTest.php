<?php

use App\Actions\Notifications\RegisterPushSubscription;
use App\Models\FeatureFlag;
use App\Models\PersonalAccessToken;
use App\Models\PushSubscription;
use App\Models\User;
use App\Services\Auth\DeviceSessions;
use App\Services\Notifications\WebPush;
use App\Services\Notifications\WebPushHttp;
use App\Services\Notifications\WebPushSessions;
use Database\Factories\PushSubscriptionFactory;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Response;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Minishlink\WebPush\VAPID;
use Psr\Http\Client\ClientInterface;

require_once dirname(__DIR__).'/Settings/SettingsTestHelpers.php';

/**
 * SEC-414-02 (Medium): a browser's Web Push ends with the member web session that registered it, also when that session expires
 * without a sign-out (a shared computer). The hourly prune deletes subscriptions of ended sessions (and, whatever the driver, those no
 * browser renewed for orphan_days), and a send never reaches a browser whose session is gone. Never the network: Guzzle MockHandler.
 */
beforeEach(function () {
    Http::preventStrayRequests();
    config(['session.driver' => 'database']);
    $this->member = User::factory()->create(['username' => 'lena.911']);
});

function wpsSession(User $user, string $id, int $minutesAgo = 1): void
{
    DB::table('sessions')->insert([
        'id' => $id,
        'user_id' => $user->id,
        'ip_address' => null,
        'user_agent' => 'Mozilla/5.0 (Macintosh) Chrome/131',
        'payload' => base64_encode(serialize([])),
        'last_activity' => now()->subMinutes($minutesAgo)->getTimestamp(),
    ]);
}

function wpsSubscription(User $user, ?string $sessionId, array $attributes = []): PushSubscription
{
    return PushSubscription::factory()->create([
        'user_id' => $user->id,
        'session_key' => $sessionId === null ? null : PushSubscription::sessionKey($sessionId),
        ...$attributes,
    ]);
}

it('stops Web Push once the browser session that registered it is gone', function () {
    $sub = wpsSubscription($this->member, 'expired-session');
    // No sessions row 'expired-session' (expired and pruned).
    $this->artisan('speedclub:prune-platform')->assertSuccessful();

    expect(PushSubscription::query()->whereKey($sub->id)->exists())->toBeFalse();
});

it('prunes the subscription of a session that expired idle in the same run, keeps the live one', function () {
    wpsSession($this->member, 'live-session', 5);
    wpsSession($this->member, 'idle-session', config()->integer('session.lifetime') + 10);
    $live = wpsSubscription($this->member, 'live-session');
    $idle = wpsSubscription($this->member, 'idle-session');

    $this->artisan('speedclub:prune-platform')->assertSuccessful();

    expect(PushSubscription::query()->whereKey($live->id)->exists())->toBeTrue()
        ->and(PushSubscription::query()->whereKey($idle->id)->exists())->toBeFalse()
        ->and(DB::table('sessions')->where('id', 'idle-session')->exists())->toBeFalse();
});

it('keeps a subscription of another member’s live session from counting', function () {
    $other = User::factory()->create();
    wpsSession($other, 'shared-id');
    $sub = wpsSubscription($this->member, 'shared-id');

    $this->artisan('speedclub:prune-platform')->assertSuccessful();

    expect(PushSubscription::query()->whereKey($sub->id)->exists())->toBeFalse();
});

it('drops subscriptions no browser renewed for orphan_days, whatever the session driver', function (string $driver) {
    config(['session.driver' => $driver]);
    $old = wpsSubscription($this->member, null);
    $old->forceFill(['updated_at' => now()->subDays(config()->integer('speedclub.web_push.orphan_days') + 1)])->saveQuietly();
    $fresh = wpsSubscription($this->member, null);

    $this->artisan('speedclub:prune-platform')->assertSuccessful();

    expect(PushSubscription::query()->whereKey($old->id)->exists())->toBeFalse()
        ->and(PushSubscription::query()->whereKey($fresh->id)->exists())->toBeTrue();
})->with(['database' => ['database'], 'file' => ['file']]);

it('never sends to a browser whose session is gone, and deletes it on the way', function () {
    $keys = VAPID::createVapidKeys();
    config([
        'speedclub.web_push.public_key' => $keys['publicKey'],
        'speedclub.web_push.private_key' => $keys['privateKey'],
        'speedclub.web_push.subject' => 'mailto:support@speedclub.de',
    ]);
    FeatureFlag::query()->updateOrCreate(['key' => 'web_push'], ['enabled' => true]);
    $calls = [];
    $stack = HandlerStack::create(new MockHandler([new Response(201), new Response(201)]));
    $stack->push(Middleware::history($calls));
    app()->instance(WebPushHttp::class, new class($stack) extends WebPushHttp
    {
        public function __construct(private readonly HandlerStack $stack) {}

        public function client(): ClientInterface
        {
            return new Client(['handler' => $this->stack, 'http_errors' => false, 'allow_redirects' => false]);
        }
    });

    wpsSession($this->member, 'live-session');
    $live = wpsSubscription($this->member, 'live-session');
    $gone = wpsSubscription($this->member, 'gone-session');

    $delivered = app(WebPush::class)->send(PushSubscription::query()->where('user_id', $this->member->id)->get(), 'SPEED CLUB', 'Neue Anmeldung', '/notifications');

    expect($delivered)->toBe(1)
        ->and($calls)->toHaveCount(1)
        ->and(PushSubscription::query()->whereKey($gone->id)->exists())->toBeFalse()
        ->and(PushSubscription::query()->whereKey($live->id)->exists())->toBeTrue()
        ->and((string) $calls[0]['request']->getUri())->toBe($live->endpoint);
});

/**
 * SEC-P4-01 (Medium): the bearer-path twin of SEC-414-02. A subscription registered with an app token (no member web session) is tied
 * to that token: SET-06 "Abmelden" of that device, its sign-out, "Alle anderen abmelden" and its expiry end it, and a rotation moves the
 * tie to the new token. The first test is probe P2 of docs/reports/security/phase-4.md turned round.
 */
describe('SEC-P4-01 tied to the app token that registered it', function () {
    beforeEach(function () {
        FeatureFlag::query()->updateOrCreate(['key' => 'web_push'], ['enabled' => true]);
    });

    function wpsTokenSubscribe(string $token): PushSubscription
    {
        test()->withToken($token)->postJson('/api/v1/me/push-subscriptions', [
            'endpoint' => 'https://fcm.googleapis.com/fcm/send/'.Str::random(40),
            'keys' => [
                'p256dh' => PushSubscriptionFactory::base64url(PushSubscriptionFactory::p256Point()),
                'auth' => PushSubscriptionFactory::base64url(random_bytes(16)),
            ],
        ])->assertNoContent();
        app('auth')->forgetGuards();

        return PushSubscription::query()->latest('created_at')->latest('id')->firstOrFail();
    }

    function wpsTokenId(string $plain): int
    {
        return (int) PersonalAccessToken::findToken($plain)?->getKey();
    }

    /**
     * @return list<PushSubscription>
     */
    function wpsLive(User $member): array
    {
        return app(WebPushSessions::class)->live(PushSubscription::query()->where('user_id', $member->id)->get());
    }

    it('ends a Web Push registered with a token when that device is signed out in SET-06 (probe P2)', function () {
        $owner = setSignIn($this->member, 'install-owner-001', 'iPhone 15 Pro');
        $intruder = setSignIn($this->member, 'install-other-001', 'Fremdes Telefon');
        $sub = wpsTokenSubscribe($intruder);

        expect($sub->session_key)->toBeNull()->and($sub->token_id)->toBe(wpsTokenId($intruder));

        $this->withToken($owner)->deleteJson('/api/v1/me/sessions/t'.wpsTokenId($intruder))->assertNoContent();
        app('auth')->forgetGuards();
        $this->withToken($intruder)->getJson('/api/v1/auth/me')->assertUnauthorized();
        $this->artisan('speedclub:prune-platform')->assertSuccessful();

        expect(PushSubscription::query()->whereKey($sub->id)->exists())->toBeFalse()
            ->and(wpsLive($this->member))->toBe([]);
    });

    it('ends it with that token\'s sign-out, and keeps the subscription of another device', function () {
        $owner = setSignIn($this->member, 'install-owner-001');
        $other = setSignIn($this->member, 'install-other-001', 'Pixel 9');
        $mine = wpsTokenSubscribe($owner);
        $theirs = wpsTokenSubscribe($other);

        $this->withToken($other)->postJson('/api/v1/auth/logout')->assertSuccessful();

        expect(PushSubscription::query()->pluck('id')->all())->toBe([$mine->id]);
    });

    it('ends it on "Alle anderen abmelden" from the app and from the member web', function (string $from) {
        $owner = setSignIn($this->member, 'install-owner-001');
        $other = setSignIn($this->member, 'install-other-001', 'Pixel 9');
        wpsTokenSubscribe($other);

        if ($from === 'app') {
            $this->withToken($owner)->deleteJson('/api/v1/me/sessions')->assertNoContent();
        } else {
            $here = Str::random(40);
            wpsSession($this->member, $here);
            $session = app('session')->driver();
            $session->setId($here);
            $request = Request::create('/api/v1/me/sessions', 'DELETE');
            $request->setLaravelSession($session);
            app(DeviceSessions::class)->revokeOthers($this->member, $request);
        }

        expect(PushSubscription::query()->where('user_id', $this->member->id)->count())->toBe(0);
    })->with(['app' => ['app'], 'member web' => ['web']]);

    it('treats a subscription whose token expired as ended, at send time and in the prune, whatever the session driver', function (string $driver) {
        config(['session.driver' => $driver]);
        $token = setSignIn($this->member, 'install-other-001');
        $sub = wpsTokenSubscribe($token);
        $live = wpsTokenSubscribe(setSignIn($this->member, 'install-third-001', 'Pixel 9'));
        PersonalAccessToken::query()->whereKey(wpsTokenId($token))->update(['expires_at' => now()->subMinute()]);

        expect(collect(wpsLive($this->member))->pluck('id')->all())->toBe([$live->id])
            ->and(PushSubscription::query()->whereKey($sub->id)->exists())->toBeFalse();

        $again = wpsTokenSubscribe(setSignIn($this->member, 'install-fourth-01', 'Galaxy S24'));
        PersonalAccessToken::query()->whereKey($again->token_id)->update(['expires_at' => now()->subMinute()]);
        $this->artisan('speedclub:prune-platform')->assertSuccessful();

        expect(PushSubscription::query()->pluck('id')->all())->toBe([$live->id]);
    })->with(['database' => ['database'], 'array' => ['array']]);

    it('never counts a token of another member as the tie', function () {
        $sub = PushSubscription::factory()->create([
            'user_id' => $this->member->id,
            'token_id' => wpsTokenId(setSignIn(User::factory()->create(), 'install-other-001')),
        ]);

        expect(wpsLive($this->member))->toBe([])
            ->and(PushSubscription::query()->whereKey($sub->id)->exists())->toBeFalse();
    });

    it('moves the tie to the new token on a rotation, so the old one\'s end keeps it and SET-06 still ends it', function () {
        $owner = setSignIn($this->member, 'install-owner-001');
        $device = setSignIn($this->member, 'install-other-001', 'Pixel 9');
        $sub = wpsTokenSubscribe($device);
        $this->member->tokens()->update(['created_at' => now()->subDays(8)]);

        $rotated = (string) $this->withToken($device)->postJson('/api/v1/auth/token/rotate', ['device_id' => 'install-other-001'])->assertOk()->json('data.token');
        app('auth')->forgetGuards();

        expect($sub->fresh()?->token_id)->toBe(wpsTokenId($rotated));

        // The replaced token's grace ends and the prune removes it: the subscription stays.
        PersonalAccessToken::query()->whereKey(wpsTokenId($device))->delete();
        $this->artisan('speedclub:prune-platform')->assertSuccessful();
        expect(collect(wpsLive($this->member))->pluck('id')->all())->toBe([$sub->id]);

        $this->withToken($owner)->deleteJson('/api/v1/me/sessions/t'.wpsTokenId($rotated))->assertNoContent();

        expect(PushSubscription::query()->whereKey($sub->id)->exists())->toBeFalse();
    });

    it('stores no token tie for a member web registration', function () {
        $sub = app(RegisterPushSubscription::class)->handle($this->member, 'https://fcm.googleapis.com/fcm/send/'.Str::random(30), PushSubscriptionFactory::base64url(PushSubscriptionFactory::p256Point()), PushSubscriptionFactory::base64url(random_bytes(16)), null, Str::random(40), 42);

        expect($sub->fresh()?->token_id)->toBeNull()->and($sub->fresh()?->session_key)->not->toBeNull();
    });
});
