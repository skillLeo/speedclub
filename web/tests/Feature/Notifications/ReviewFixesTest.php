<?php

use App\Actions\Social\BlockMember;
use App\Actions\Social\FollowMember;
use App\Enums\SecurityNotice;
use App\Mail\SecurityNoticeMail;
use App\Models\Follow;
use App\Models\Notification;
use App\Models\PushToken;
use App\Models\User;
use App\Services\Auth\DeviceInstalls;
use App\Services\Notifications\Notifier;
use App\Services\Notifications\NotifyFollowersOfPublication;
use App\Services\Notifications\QuietHours;
use App\Services\Notifications\SendPushNotification;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/NotificationTestHelpers.php';

/**
 * The M2.2 code review (0690ec5), the copy review and the M2.2 fix list B2, notifications and push side.
 */
beforeEach(function () {
    Mail::fake();
    $this->withoutDefer();
    $this->travelTo(CarbonImmutable::parse('2026-11-10 12:00:00', 'Europe/Berlin'));
    $this->notifier = app(Notifier::class);
    $this->lena = ntfMember('lena.911');
    $this->lukas = ntfMember('lukas.sc');
});

describe('push texts and targets (review #1, #17, #19, B2, copy c)', function () {
    it('counts only the actors the recipient may still see in "und N weitere"', function () {
        $paul = ntfMember('paul.roadster');
        $kenji = ntfMember('kenji.r34');
        $this->notifier->newFollower($this->lena, $paul);
        $this->notifier->newFollower($this->lena, $kenji);
        app(BlockMember::class)->handle($this->lena, $kenji);
        ntfPushOn($this->lena);
        $this->travel(20)->minutes();

        $this->notifier->newFollower($this->lena, $this->lukas);

        // Two followers left to see, kenji.r34 is blocked: "und ein weiteres Mitglied", not two.
        expect(ntfPushes()[0][0]['body'])->toBe(trans_choice('notifications.new_follower', 2, ['name' => 'lukas.sc', 'count' => 1], 'de'))
            ->and(ntfPushes()[0][0]['body'])->toStartWith('@lukas.sc und ein');
    });

    it('carries the target path: one follower\'s profile, the group, the build', function () {
        ntfPushOn($this->lena);
        $row = $this->notifier->newFollower($this->lena, $this->lukas);
        $vehicle = publishedVehicle($this->lukas);
        $this->lena->forceFill(['notification_prefs' => ['types' => ['followed_published' => ['push' => true]]]])->save();
        $this->notifier->followedPublished($this->lena->refresh(), $this->lukas, $vehicle, null);
        $this->travel(20)->minutes();
        $this->notifier->newFollower($this->lena, ntfMember('paul.roadster'));

        expect(array_column(ntfPushes(), 0))->sequence(
            fn ($message) => $message->toHaveKey('data', ['type' => 'new_follower', 'notification_id' => $row?->id, 'path' => '/u/lukas.sc']),
            fn ($message) => $message->data->path->toBe('/v/'.$vehicle->slug),
            fn ($message) => $message->data->path->toBe('/notifications'),
        );
    });

    it('sends nothing when the build went private before the push ran, rather than "@lukas.sc hat ein Update zu ."', function () {
        ntfPushOn($this->lena);
        $this->lena->forceFill(['notification_prefs' => ['types' => ['followed_published' => ['push' => true]]]])->save();
        $vehicle = publishedVehicle($this->lukas);
        Queue::fake();
        $row = $this->notifier->followedPublished($this->lena->refresh(), $this->lukas, $vehicle, null);
        $vehicle->forceFill(['visibility' => 'private'])->save();

        app()->call([new SendPushNotification((string) $row?->id), 'handle']);

        expect(ntfPushes())->toBe([]);
    });

    it('decides again when the queued push runs: quiet hours, the switch, push off (review #4)', function (Closure $change) {
        ntfPushOn($this->lena);
        Queue::fake();
        $row = $this->notifier->newFollower($this->lena, $this->lukas);
        Queue::assertPushed(SendPushNotification::class);
        $change($this);

        app()->call([new SendPushNotification((string) $row?->id), 'handle']);

        expect(ntfPushes())->toBe([]);
    })->with([
        'quiet hours began' => [fn ($test) => $test->travelTo(CarbonImmutable::parse('2026-11-10 22:30:00', 'Europe/Berlin'))],
        'switched off' => [fn ($test) => $test->lena->forceFill(['notification_prefs' => ['types' => ['new_follower' => ['push' => false]]]])->save()],
        'push disabled' => [fn () => config(['speedclub.push.enabled' => false])],
        'actor blocked' => [fn ($test) => app(BlockMember::class)->handle($test->lena, $test->lukas)],
    ]);
});

describe('quiet hours across the clock changes (review #18)', function () {
    it('holds on the nights summer time starts and ends', function (string $utc, bool $quiet) {
        expect(QuietHours::inside('22:00', '07:00', CarbonImmutable::parse($utc, 'UTC')))->toBe($quiet);
    })->with([
        // 29 March 2026: 02:00 CET becomes 03:00 CEST.
        'spring, 21:30 CET' => ['2026-03-28 20:30:00', false],
        'spring, 22:00 CET' => ['2026-03-28 21:00:00', true],
        'spring, 03:30 CEST' => ['2026-03-29 01:30:00', true],
        'spring, 06:59 CEST' => ['2026-03-29 04:59:00', true],
        'spring, 07:00 CEST' => ['2026-03-29 05:00:00', false],
        // 25 October 2026: 03:00 CEST becomes 02:00 CET; 02:30 happens twice.
        'autumn, 02:30 CEST' => ['2026-10-25 00:30:00', true],
        'autumn, 02:30 CET' => ['2026-10-25 01:30:00', true],
        'autumn, 07:00 CET' => ['2026-10-25 06:00:00', false],
        'autumn, 21:59 CET' => ['2026-10-25 20:59:00', false],
    ]);
});

describe('grouping and resilience (review #10, #21)', function () {
    it('keeps a slice retried after midnight in the day it was published', function () {
        socFollow($this->lena, $this->lukas);
        $vehicle = publishedVehicle($this->lukas);
        $this->travelTo(CarbonImmutable::parse('2026-11-11 00:20:00', 'Europe/Berlin'));

        (new NotifyFollowersOfPublication($this->lukas->id, $vehicle->id, '', '2026-11-10'))->handle($this->notifier);

        expect(Notification::query()->sole()->group_key)->toBe("followed_published:{$this->lukas->id}:2026-11-10");
    });

    it('follows even when the notification fails, and reports the failure', function () {
        Exceptions::fake();
        $this->mock(Notifier::class)->shouldReceive('newFollower')->andThrow(new RuntimeException('down'));

        app(FollowMember::class)->handle($this->lena, $this->lukas);

        expect(Follow::query()->count())->toBe(1);
        Exceptions::assertReported(fn (RuntimeException $exception): bool => $exception->getMessage() === 'down');
    });
});

describe('followed_published rows (review #11)', function () {
    it('leaves hidden build updates out of the count and the update id', function () {
        $vehicle = publishedVehicle($this->lukas);
        $first = ntfUpdate($vehicle);
        $this->notifier->followedPublished($this->lena, $this->lukas, $vehicle, $first);
        $second = ntfUpdate($vehicle);
        $this->notifier->followedPublished($this->lena, $this->lukas, $vehicle, $second);
        $second->forceFill(['hidden' => true])->save();
        Sanctum::actingAs($this->lena);

        $this->getJson('/api/v1/notifications')->assertOk()
            ->assertJsonPath('data.0.details', ['kind' => 'update', 'update_id' => null, 'vehicles' => 0, 'updates' => 1]);
    });
});

describe('push tokens (review #5, #6, #7)', function () {
    it('takes a device away from the member who used it before when another signs in with its id', function () {
        $before = ntfMember('vorher', ['email' => 'vorher@example.de']);
        // SEC-M47-03: as stored, keyed to the member, with the install key that joins nothing across accounts.
        PushToken::factory()->create(['user_id' => $before->id, 'device_id' => DeviceInstalls::key($before->id, '6f1c2b0e-8d4a-4f7e-9a51-0c3e1d2b4a01'), 'install_key' => DeviceInstalls::installKey('6f1c2b0e-8d4a-4f7e-9a51-0c3e1d2b4a01')]);
        PushToken::factory()->create(['user_id' => $before->id, 'device_id' => DeviceInstalls::key($before->id, '0b9e7d55-21c4-4a8f-b6e2-7f3a9c1d5e02'), 'install_key' => DeviceInstalls::installKey('0b9e7d55-21c4-4a8f-b6e2-7f3a9c1d5e02')]);
        ntfMember('danach', ['email' => 'danach@example.de', 'password' => 'Lackierung-92-rot']);

        $this->postJson('/api/v1/auth/login', [
            'email' => 'danach@example.de', 'password' => 'Lackierung-92-rot', 'device_name' => 'Pixel 9', 'platform' => 'android', 'app_version' => '0.1.0',
            'device_id' => '6f1c2b0e-8d4a-4f7e-9a51-0c3e1d2b4a01',
        ])->assertOk();

        expect(PushToken::query()->pluck('device_id')->all())->toBe([DeviceInstalls::key($before->id, '0b9e7d55-21c4-4a8f-b6e2-7f3a9c1d5e02')]);
    });

    it('refuses another install id than the one the token signed in with', function () {
        $phone = $this->lena->createToken('Pixel 9');
        $phone->accessToken->forceFill(['device_id' => DeviceInstalls::key($this->lena->id, 'install-aaaa-1')])->save();

        $this->withToken($phone->plainTextToken)->postJson('/api/v1/me/push-tokens', ['token' => 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]', 'platform' => 'ios', 'device_id' => 'install-bbbb-2'])
            ->assertUnprocessable()->assertJsonValidationErrors('device_id');
        app('auth')->forgetGuards();
        $this->withToken($phone->plainTextToken)->postJson('/api/v1/me/push-tokens', ['token' => 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]', 'platform' => 'ios', 'device_id' => 'install-aaaa-1'])
            ->assertNoContent();
    });

    it('checks the install id in the path of DELETE: a malformed id matches no route', function (string $id) {
        Sanctum::actingAs($this->lena);

        $this->deleteJson('/api/v1/me/push-tokens/'.$id)->assertNotFound();
    })->with(['kurz', 'mit.punkt.und.mehr', str_repeat('a', 65)]);

    it('documents the install id of DELETE only as its path parameter', function () {
        $this->artisan('scramble:export', ['--path' => storage_path('framework/testing/openapi-push.json')])->assertSuccessful();
        $document = json_decode((string) file_get_contents(storage_path('framework/testing/openapi-push.json')), true);
        $parameters = $document['paths']['/me/push-tokens/{deviceId}']['delete']['parameters'];

        expect(array_map(fn (array $p): string => $p['in'].':'.$p['name'], $parameters))->toBe(['path:deviceId']);
    });

    it('limits reading notifications and the unread count', function (string $name) {
        expect(Route::getRoutes()->getByName($name)?->gatherMiddleware())->toContain('throttle:browse');
    })->with(['api.v1.notifications.index', 'api.v1.notifications.unread-count']);
});

describe('the e-mail-changed mail (copy b)', function () {
    it('points to support, not to a password reset whose code would reach the new address', function () {
        config(['speedclub.app_config.links.support_email' => 'hilfe@speedclub.de']);

        $mail = new SecurityNoticeMail(SecurityNotice::EmailChanged);
        $mail->locale('de');
        $html = $mail->render();

        expect($html)->toContain('mailto:hilfe@speedclub.de')
            // Copy review M4.7: support, or "Das war ich nicht" in the app, and still no reset of the password.
            ->toContain('schreib uns an hilfe@speedclub.de')
            ->toContain('Das war ich nicht')
            ->toContain('Setz dein Passwort in diesem Fall nicht selbst zurück')
            ->not->toContain('/app/forgot-password');

        expect((new SecurityNoticeMail(SecurityNotice::NewDevice, 'Pixel'))->render())->toContain('/app/forgot-password');
    });
});

it('stores only what the member changed in notification_prefs (review #9)', function () {
    Sanctum::actingAs($this->lena);

    $this->patchJson('/api/v1/me/settings', ['notification_prefs' => ['types' => ['build_saved' => ['push' => true]]]])->assertOk();
    $this->patchJson('/api/v1/me/settings', ['notification_prefs' => ['quiet_hours' => ['from' => '23:00']]])->assertOk();

    expect(json_decode((string) User::query()->toBase()->where('id', $this->lena->id)->value('notification_prefs'), true))
        ->toBe(['types' => ['build_saved' => ['push' => true]], 'quiet_hours' => ['from' => '23:00']]);
});
