<?php

use App\Enums\DevicePlatform;
use App\Enums\RestrictionType;
use App\Http\RateLimits;
use App\Models\PushToken;
use App\Models\User;
use App\Services\Auth\MemberSessions;
use App\Services\Notifications\ExpoPush;
use App\Services\Notifications\Notifier;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/NotificationTestHelpers.php';

/**
 * M2.2 push: POST/DELETE me/push-tokens, sign-out, ExpoPush and push:receipts. Never the network: Http::preventStrayRequests.
 */
const NTF_TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';

beforeEach(function () {
    Mail::fake();
    Http::preventStrayRequests();
    $this->member = ntfMember('lena.911');
});

function ntfRegister(array $body = []): mixed
{
    return test()->postJson('/api/v1/me/push-tokens', ['token' => NTF_TOKEN, 'platform' => 'ios', 'device_id' => 'install-a', ...$body]);
}

describe('POST me/push-tokens', function () {
    it('registers once per install, idempotently, and a new token of the install replaces the old', function () {
        Sanctum::actingAs($this->member);

        ntfRegister()->assertNoContent();
        ntfRegister()->assertNoContent();
        ntfRegister(['token' => 'ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]'])->assertNoContent();
        ntfRegister(['token' => 'ExpoPushToken[zzzzzzzzzzzzzzzzzzzzzz]', 'device_id' => 'install-b', 'platform' => 'android'])->assertNoContent();

        expect(PushToken::query()->where('user_id', $this->member->id)->orderBy('device_id')->get()->map(fn (PushToken $token) => [$token->device_id, $token->getAttribute('token'), $token->platform])->all())
            ->toBe([
                ['install-a', 'ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]', DevicePlatform::Ios],
                ['install-b', 'ExpoPushToken[zzzzzzzzzzzzzzzzzzzzzz]', DevicePlatform::Android],
            ]);
    });

    it('moves an install to the member who signed in on it last', function () {
        $before = ntfMember('lukas.sc');
        Sanctum::actingAs($before);
        ntfRegister()->assertNoContent();

        Sanctum::actingAs($this->member);
        ntfRegister()->assertNoContent();

        expect(PushToken::query()->pluck('user_id')->all())->toBe([$this->member->id]);
    });

    it('validates token, platform and install id', function (array $body, string $field) {
        Sanctum::actingAs($this->member);

        ntfRegister($body)->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        [['token' => 'abc'], 'token'],
        [['token' => 'ExponentPushToken[]'], 'token'],
        [['token' => 'ExponentPushToken[x"; DROP]'], 'token'],
        [['platform' => 'web'], 'platform'],
        [['platform' => 'windows'], 'platform'],
        [['device_id' => ''], 'device_id'],
        [['device_id' => str_repeat('a', 101)], 'device_id'],
        [['device_id' => 'mit leerzeichen'], 'device_id'],
    ]);

    it('replays with the same Idempotency-Key', function () {
        Sanctum::actingAs($this->member);

        $this->postJson('/api/v1/me/push-tokens', ['token' => NTF_TOKEN, 'platform' => 'ios', 'device_id' => 'install-a'], ['Idempotency-Key' => 'k-1'])->assertNoContent();
        $this->postJson('/api/v1/me/push-tokens', ['token' => NTF_TOKEN, 'platform' => 'ios', 'device_id' => 'install-a'], ['Idempotency-Key' => 'k-1'])->assertNoContent();

        expect(PushToken::query()->count())->toBe(1);
    });

    it('is limited', function () {
        config(['speedclub.rate_limits.push_tokens.max' => 1]);
        RateLimits::register();
        Sanctum::actingAs($this->member);

        ntfRegister()->assertNoContent();
        ntfRegister()->assertStatus(429)->assertJsonPath('code', 'rate_limited');
    });

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        socActAs($who());

        ntfRegister()->assertStatus($status);
    })->with([
        'guest' => [fn (): ?User => null, 401],
        'member' => [fn (): ?User => User::factory()->create(), 204],
        'unverified member' => [fn (): ?User => User::factory()->unverified()->create(), 204],
        'member restricted from messaging' => [fn (): ?User => User::factory()->restrictedFrom(RestrictionType::Messaging)->create(), 204],
        'suspended member' => [fn (): ?User => User::factory()->suspended()->create(), 204],
        'deactivated member' => [fn (): ?User => User::factory()->deactivated()->create(), 403],
    ]);
});

describe('DELETE me/push-tokens/{device_id}', function () {
    it('removes the member\'s token of that install only, and an unknown install is no error', function () {
        $other = ntfMember('lukas.sc');
        PushToken::factory()->create(['user_id' => $this->member->id, 'device_id' => 'install-a']);
        PushToken::factory()->create(['user_id' => $this->member->id, 'device_id' => 'install-b']);
        PushToken::factory()->create(['user_id' => $other->id, 'device_id' => 'install-c']);
        Sanctum::actingAs($this->member);

        $this->deleteJson('/api/v1/me/push-tokens/install-a')->assertNoContent();
        $this->deleteJson('/api/v1/me/push-tokens/install-c')->assertNoContent();
        $this->deleteJson('/api/v1/me/push-tokens/nichts-da')->assertNoContent();

        expect(PushToken::query()->orderBy('device_id')->pluck('device_id')->all())->toBe(['install-b', 'install-c']);
    });

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        socActAs($who());

        $this->deleteJson('/api/v1/me/push-tokens/install-a')->assertStatus($status);
    })->with([
        'guest' => [fn (): ?User => null, 401],
        'member' => [fn (): ?User => User::factory()->create(), 204],
        'deactivated member' => [fn (): ?User => User::factory()->deactivated()->create(), 403],
    ]);
});

describe('signing out', function () {
    it('deletes the push token of the device it signs out, not of the others', function () {
        $phone = $this->member->createToken('iPhone 15');
        $phone->accessToken->forceFill(['device_id' => 'install-a'])->save();
        PushToken::factory()->create(['user_id' => $this->member->id, 'device_id' => 'install-a']);
        PushToken::factory()->create(['user_id' => $this->member->id, 'device_id' => 'install-b']);

        $this->withToken($phone->plainTextToken)->postJson('/api/v1/auth/logout')->assertNoContent();

        expect(PushToken::query()->pluck('device_id')->all())->toBe(['install-b']);
    });

    it('deletes every push token when a password reset signs out every device', function () {
        PushToken::factory()->count(2)->create(['user_id' => $this->member->id]);

        app(MemberSessions::class)->revokeAll($this->member);

        expect(PushToken::query()->count())->toBe(0);
    });
});

describe('ExpoPush', function () {
    it('sends nothing while push is disabled', function () {
        config(['speedclub.push.enabled' => false]);
        Http::fake();
        $tokens = PushToken::factory()->count(2)->create(['user_id' => $this->member->id]);

        expect(app(ExpoPush::class)->send($tokens, 'SPEED CLUB', 'Text', []))->toBe(0)
            ->and(app(ExpoPush::class)->checkReceipts())->toBe(['checked' => 0, 'removed_tokens' => 0]);
        Http::assertNothingSent();
    });

    it('sends in batches of 100 with the access token when set, keeps tickets and drops uninstalled tokens at once', function () {
        config(['speedclub.push.enabled' => true, 'speedclub.services.expo_access_token' => 'expo-secret']);
        $tokens = PushToken::factory()->count(150)->create(['user_id' => $this->member->id]);
        $dead = $tokens[3];
        Http::fake(['exp.host/--/api/v2/push/send' => function ($request) use ($dead) {
            return Http::response(['data' => array_map(
                fn (array $message, int $i) => $message['to'] === $dead->getAttribute('token')
                    ? ['status' => 'error', 'message' => 'not registered', 'details' => ['error' => 'DeviceNotRegistered']]
                    : ['status' => 'ok', 'id' => 'ticket-'.$i.'-'.substr(md5($message['to']), 0, 8)],
                $request->data(),
                array_keys($request->data()),
            )]);
        }]);

        $tickets = app(ExpoPush::class)->send($tokens, 'SPEED CLUB', '@lukas.sc folgt dir jetzt.', ['type' => 'new_follower']);

        expect($tickets)->toBe(149)
            ->and(DB::table('push_tickets')->count())->toBe(149)
            ->and(PushToken::query()->whereKey($dead->id)->exists())->toBeFalse();
        Http::assertSentCount(2);
        Http::assertSent(fn ($request) => count($request->data()) <= 100 && $request->hasHeader('Authorization', 'Bearer expo-secret'));
    });

    it('keeps going when Expo is down, without logging a token', function () {
        config(['speedclub.push.enabled' => true]);
        Http::fake(['exp.host/*' => Http::response('down', 503)]);
        $tokens = PushToken::factory()->count(2)->create(['user_id' => $this->member->id]);

        expect(app(ExpoPush::class)->send($tokens, 'SPEED CLUB', 'Text', []))->toBe(0);
    });

    it('reads receipts, removes DeviceNotRegistered tokens and forgets checked and stale tickets', function () {
        config(['speedclub.push.enabled' => true]);
        $alive = PushToken::factory()->create(['user_id' => $this->member->id]);
        $gone = PushToken::factory()->create(['user_id' => $this->member->id]);
        DB::table('push_tickets')->insert([
            ['ticket_id' => 't-alive', 'push_token_id' => $alive->id, 'created_at' => now()->subMinutes(20)],
            ['ticket_id' => 't-gone', 'push_token_id' => $gone->id, 'created_at' => now()->subMinutes(20)],
            ['ticket_id' => 't-fresh', 'push_token_id' => $alive->id, 'created_at' => now()->subMinutes(2)],
            ['ticket_id' => 't-stale', 'push_token_id' => $alive->id, 'created_at' => now()->subDays(2)],
        ]);
        Http::fake(['exp.host/--/api/v2/push/getReceipts' => Http::response(['data' => [
            't-alive' => ['status' => 'ok'],
            't-gone' => ['status' => 'error', 'details' => ['error' => 'DeviceNotRegistered']],
        ]])]);

        $this->artisan('push:receipts')->assertSuccessful();

        expect(PushToken::query()->pluck('id')->all())->toBe([$alive->id])
            ->and(DB::table('push_tickets')->pluck('ticket_id')->all())->toBe(['t-fresh']);
        Http::assertSent(fn ($request) => $request->data() === ['ids' => ['t-alive', 't-gone']]);
    });

    it('carries the notification id and the type, never a message, from Notifier to Expo', function () {
        $this->travelTo(CarbonImmutable::parse('2026-11-10 12:00:00', 'Europe/Berlin'));
        ntfPushOn($this->member);

        app(Notifier::class)->newFollower($this->member, ntfMember('lukas.sc'));

        $message = ntfPushes()[0][0];
        expect(array_keys($message))->toBe(['to', 'title', 'body', 'data', 'sound'])
            ->and(array_keys($message['data']))->toBe(['type', 'notification_id', 'path']);
    });
});
