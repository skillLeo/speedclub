<?php

use App\Actions\Garage\SaveModification;
use App\Actions\Social\BlockMember;
use App\Actions\Social\FollowMember;
use App\Enums\ModStatus;
use App\Enums\NotificationType;
use App\Enums\RestrictionType;
use App\Enums\SecurityNotice;
use App\Mail\SecurityNoticeMail;
use App\Models\Notification;
use App\Models\User;
use App\Services\Notifications\Notifier;
use App\Services\Notifications\NotifyFollowersOfPublication;
use App\Services\Notifications\QuietHours;
use App\Services\Notifications\SendPushNotification;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;

require_once __DIR__.'/NotificationTestHelpers.php';

/**
 * App\Services\Notifications\Notifier (M2.2): every cell of the 02_PRODUCT_SPEC §7 matrix built now, grouping, blocks, preferences and
 * quiet hours in Europe/Berlin with a frozen clock.
 */
beforeEach(function () {
    Mail::fake();
    // Security mails leave after the response (ADR-130); here they leave at once.
    $this->withoutDefer();
    // Midday in Berlin: outside the default quiet hours.
    $this->travelTo(CarbonImmutable::parse('2026-11-10 12:00:00', 'Europe/Berlin'));
    $this->notifier = app(Notifier::class);
    $this->lena = ntfMember('lena.911');
    $this->lukas = ntfMember('lukas.sc');
});

describe('the matrix', function () {
    it('new_follower: an in-app row, a push by default, no mail', function () {
        ntfPushOn($this->lena);

        $row = $this->notifier->newFollower($this->lena, $this->lukas);

        expect($row?->type)->toBe(NotificationType::NewFollower)
            ->and($row?->group_key)->toBe('new_follower:2026-11-10')
            ->and($row?->actor_id)->toBe($this->lukas->id)
            ->and($row?->actor_count)->toBe(1)
            ->and(ntfPushes())->toHaveCount(1)
            ->and(ntfPushes()[0][0])->toMatchArray(['to' => 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]', 'title' => 'SPEED CLUB', 'body' => '@lukas.sc folgt dir jetzt.'])
            ->and(ntfPushes()[0][0]['data'])->toBe(['type' => 'new_follower', 'notification_id' => $row?->id, 'path' => '/u/lukas.sc']);
        Mail::assertNothingOutgoing();
    });

    it('followed_published: an in-app row, push only when switched on', function () {
        ntfPushOn($this->lena);
        $vehicle = publishedVehicle($this->lukas);

        $row = $this->notifier->followedPublished($this->lena, $this->lukas, $vehicle, null);

        expect($row?->type)->toBe(NotificationType::FollowedPublished)
            ->and($row?->vehicle_id)->toBe($vehicle->id)
            ->and($row?->data)->toMatchArray(['kind' => 'vehicle', 'published_ids' => [$vehicle->id]])
            ->and(ntfPushes())->toBe([]);

        $this->lena->forceFill(['notification_prefs' => ['types' => ['followed_published' => ['push' => true]]]])->save();
        $update = ntfUpdate($vehicle);
        $this->travel(20)->minutes();
        $this->notifier->followedPublished($this->lena->refresh(), $this->lukas, $vehicle, $update);

        expect(ntfPushes())->toHaveCount(1)
            ->and(ntfPushes()[0][0]['body'])->toStartWith('@lukas.sc hat ein Update zu ');
    });

    it('build_saved: an in-app row with the count and never who, push off by default', function () {
        ntfPushOn($this->lena);
        $vehicle = publishedVehicle($this->lena);

        $row = $this->notifier->buildSaved($this->lena, $vehicle, 3, '2026-W45');

        expect($row?->type)->toBe(NotificationType::BuildSaved)
            ->and($row?->actor_count)->toBe(3)
            ->and($row?->actor_id)->toBeNull()
            ->and($row?->actors()->count())->toBe(0)
            ->and($row?->group_key)->toBe("build_saved:{$vehicle->id}:2026-W45")
            ->and(ntfPushes())->toBe([])
            ->and($this->notifier->buildSaved($this->lena, $vehicle, 0, '2026-W45'))->toBeNull();
    });

    it('security: an in-app row and the mandatory mail, whatever the preferences, never a push (the login alert aside)', function (SecurityNotice $notice) {
        ntfPushOn($this->lena);
        $this->lena->forceFill(['notification_prefs' => ['types' => ['new_follower' => ['push' => false]], 'quiet_hours' => ['enabled' => true, 'from' => '00:00', 'to' => '23:59']]])->save();

        $row = $this->notifier->security($this->lena, $notice, 'iPhone 15');

        expect($row?->type)->toBe(NotificationType::Security)
            ->and($row?->group_key)->toBeNull()
            ->and($row?->data)->toBe(['event' => $notice->value, 'device_name' => 'iPhone 15'])
            ->and(ntfPushes())->toBe([]);
        Mail::assertSent(SecurityNoticeMail::class, fn (SecurityNoticeMail $mail): bool => $mail->notice === $notice && $mail->hasTo($this->lena->email));
    })->with(array_values(array_filter(SecurityNotice::cases(), fn (SecurityNotice $notice): bool => $notice !== SecurityNotice::NewDevice)));

    it('security: the login alert (new device) pushes, whatever the switches and quiet hours (09 §8.4)', function () {
        ntfPushOn($this->lena);
        $this->lena->forceFill(['notification_prefs' => ['types' => ['new_follower' => ['push' => false]], 'quiet_hours' => ['enabled' => true, 'from' => '00:00', 'to' => '23:59']]])->save();

        $row = $this->notifier->security($this->lena, SecurityNotice::NewDevice, 'iPhone 15');

        expect($row?->data)->toBe(['event' => 'new_device', 'device_name' => 'iPhone 15'])
            ->and(ntfPushes())->not->toBe([]);
    });

    it('security rows never group: two events are two rows', function () {
        $this->notifier->security($this->lena, SecurityNotice::NewDevice, 'Pixel 9');
        $this->notifier->security($this->lena, SecurityNotice::NewDevice, 'Pixel 9');

        expect(ntfRows($this->lena))->toBe(2);
    });

    it('sends nothing with push disabled, and writes the row all the same', function () {
        config(['speedclub.push.enabled' => false]);
        Http::preventStrayRequests();
        Http::fake();
        Queue::fake();

        expect($this->notifier->newFollower($this->lena, $this->lukas))->not->toBeNull();

        Queue::assertNotPushed(SendPushNotification::class);
        Http::assertNothingSent();
    });
});

describe('grouping', function () {
    it('groups new followers per day in Europe/Berlin, newest actor first, and a second follow on the day changes nothing', function () {
        $paul = ntfMember('paul.roadster');
        $kenji = ntfMember('kenji.r34');

        $this->notifier->newFollower($this->lena, $this->lukas);
        $this->travel(5)->minutes();
        $this->notifier->newFollower($this->lena, $paul);
        $this->travel(5)->minutes();
        $this->notifier->newFollower($this->lena, $kenji);
        $before = Notification::query()->where('notifiable_id', $this->lena->id)->sole();
        $this->notifier->newFollower($this->lena, $paul);

        $row = Notification::query()->where('notifiable_id', $this->lena->id)->sole();

        expect($row->actor_count)->toBe(3)
            ->and($row->actor_id)->toBe($kenji->id)
            ->and($row->actors->pluck('username')->all())->toBe(['kenji.r34', 'paul.roadster', 'lukas.sc'])
            ->and($row->created_at?->equalTo($before->created_at))->toBeTrue();
    });

    it('starts a new group after midnight in Berlin, not in UTC', function () {
        $this->travelTo(CarbonImmutable::parse('2026-11-10 23:30:00', 'Europe/Berlin'));
        $this->notifier->newFollower($this->lena, $this->lukas);
        // 00:10 in Berlin is still 23:10 UTC of the day before.
        $this->travelTo(CarbonImmutable::parse('2026-11-11 00:10:00', 'Europe/Berlin'));
        $this->notifier->newFollower($this->lena, ntfMember('paul.roadster'));

        expect(Notification::query()->where('notifiable_id', $this->lena->id)->orderBy('group_key')->pluck('group_key')->all())
            ->toBe(['new_follower:2026-11-10', 'new_follower:2026-11-11']);
    });

    it('moves a grouped row up and marks it unread again when somebody joins', function () {
        $row = $this->notifier->newFollower($this->lena, $this->lukas);
        $row?->forceFill(['read_at' => now()])->save();
        $this->travel(2)->hours();

        $this->notifier->newFollower($this->lena, ntfMember('paul.roadster'));

        expect($row?->refresh()->read_at)->toBeNull()
            ->and($row?->created_at?->equalTo(now()))->toBeTrue();
    });

    it('groups a followed member\'s publications per member and day, counting builds and updates', function () {
        $first = publishedVehicle($this->lukas);
        $second = publishedVehicle($this->lukas);

        $this->notifier->followedPublished($this->lena, $this->lukas, $first, null);
        $this->notifier->followedPublished($this->lena, $this->lukas, $first, ntfUpdate($first));
        $last = ntfUpdate($second);
        $row = $this->notifier->followedPublished($this->lena, $this->lukas, $second, $last);
        $this->notifier->followedPublished($this->lena, ntfMember('paul.roadster'), publishedVehicle(), null);

        expect(ntfRows($this->lena))->toBe(2)
            ->and($row?->actor_count)->toBe(1)
            ->and($row?->vehicle_id)->toBe($second->id)
            ->and($row?->data)->toMatchArray(['kind' => 'update', 'update_id' => $last->id, 'published_ids' => [$first->id]])
            ->and($row?->data['update_ids'] ?? [])->toHaveCount(2)
            ->and($row?->data['vehicle_ids'] ?? [])->toBe([$second->id, $first->id]);
    });

    it('keeps the saved-builds aggregate one row per build and ISO week, updated to the latest count', function () {
        $vehicle = publishedVehicle($this->lena);

        $this->notifier->buildSaved($this->lena, $vehicle, 2, '2026-W45');
        $this->notifier->buildSaved($this->lena, $vehicle, 4, '2026-W45');
        $this->notifier->buildSaved($this->lena, $vehicle, 1, '2026-W46');

        expect(Notification::query()->where('notifiable_id', $this->lena->id)->orderBy('group_key')->pluck('actor_count')->all())->toBe([4, 1]);
    });

    it('pushes a group at most once within the cooldown', function () {
        ntfPushOn($this->lena);

        $this->notifier->newFollower($this->lena, $this->lukas);
        $this->travel(5)->minutes();
        $this->notifier->newFollower($this->lena, ntfMember('paul.roadster'));
        expect(ntfPushes())->toHaveCount(1);

        $this->travel(15)->minutes();
        $this->notifier->newFollower($this->lena, ntfMember('kenji.r34'));

        expect(ntfPushes())->toHaveCount(2)
            ->and(ntfPushes()[1][0]['body'])->toBe('@kenji.r34 und 2 weitere folgen dir jetzt.');
    });
});

describe('blocks and who may appear', function () {
    it('writes nothing from a member blocked in either direction', function (string $direction) {
        $direction === 'recipient blocked actor'
            ? app(BlockMember::class)->handle($this->lena, $this->lukas)
            : app(BlockMember::class)->handle($this->lukas, $this->lena);

        expect($this->notifier->newFollower($this->lena, $this->lukas))->toBeNull()
            ->and($this->notifier->followedPublished($this->lena, $this->lukas, publishedVehicle($this->lukas), null))->toBeNull()
            ->and(ntfRows($this->lena))->toBe(0);
    })->with(['recipient blocked actor', 'actor blocked recipient']);

    it('writes nothing from a member nobody may see, nor from the recipient', function (Closure $actor) {
        expect($this->notifier->newFollower($this->lena, $actor($this->lena)))->toBeNull()
            ->and(ntfRows($this->lena))->toBe(0);
    })->with([
        'unverified' => [fn () => User::factory()->unverified()->create()],
        'suspended' => [fn () => User::factory()->suspended()->create()],
        'deactivated' => [fn () => User::factory()->deactivated()->create()],
        'no username' => [fn () => User::factory()->create(['username' => null])],
        'the recipient' => [fn (User $recipient) => $recipient],
    ]);

    it('writes nothing to a recipient who cannot use the app, but security still mails', function (Closure $recipient) {
        $member = $recipient();

        expect($this->notifier->newFollower($member, $this->lukas))->toBeNull()
            ->and(ntfRows($member))->toBe(0);

        $this->notifier->security($member, SecurityNotice::PasswordChanged);
        Mail::assertSent(SecurityNoticeMail::class);
    })->with([
        'unverified' => [fn () => User::factory()->unverified()->create()],
        'suspended' => [fn () => User::factory()->suspended()->create()],
        'deactivated' => [fn () => User::factory()->deactivated()->create()],
    ]);

    it('notifies a member restricted from publishing or messaging like anybody', function () {
        $restricted = User::factory()->restrictedFrom(RestrictionType::Messaging)->create();

        expect($this->notifier->newFollower($restricted, $this->lukas))->not->toBeNull();
    });
});

describe('quiet hours (Europe/Berlin)', function () {
    it('knows the default window 22:00 to 07:00 across midnight, start inside, end outside', function (string $berlin, bool $quiet) {
        expect(QuietHours::inside('22:00', '07:00', CarbonImmutable::parse($berlin, 'Europe/Berlin')))->toBe($quiet);
    })->with([
        ['2026-11-10 21:59', false],
        ['2026-11-10 22:00', true],
        ['2026-11-11 03:00', true],
        ['2026-11-11 06:59', true],
        ['2026-11-11 07:00', false],
        ['2026-11-10 12:00', false],
        // Summer time: 22:30 in Berlin is 20:30 UTC.
        ['2026-07-10 22:30', true],
    ]);

    it('reads Berlin time whatever the clock\'s zone', function () {
        // 21:30 UTC is 22:30 in Berlin in winter.
        expect(QuietHours::inside('22:00', '07:00', CarbonImmutable::parse('2026-11-10 21:30:00', 'UTC')))->toBeTrue()
            ->and(QuietHours::inside('13:00', '14:00', CarbonImmutable::parse('2026-11-10 12:30:00', 'UTC')))->toBeTrue()
            ->and(QuietHours::inside('13:00', '13:00', CarbonImmutable::parse('2026-11-10 12:00:00', 'UTC')))->toBeFalse();
    });

    it('drops the push inside quiet hours and keeps the row', function () {
        ntfPushOn($this->lena);
        $this->travelTo(CarbonImmutable::parse('2026-11-10 23:15:00', 'Europe/Berlin'));

        $row = $this->notifier->newFollower($this->lena, $this->lukas);

        expect($row)->not->toBeNull()
            ->and($row?->refresh()->pushed_at)->toBeNull()
            ->and(ntfPushes())->toBe([]);
    });

    it('pushes at night once the member switched quiet hours off, or moved them', function (array $quiet) {
        ntfPushOn($this->lena);
        $this->lena->forceFill(['notification_prefs' => ['quiet_hours' => $quiet]])->save();
        $this->travelTo(CarbonImmutable::parse('2026-11-10 23:15:00', 'Europe/Berlin'));

        $this->notifier->newFollower($this->lena->refresh(), $this->lukas);

        expect(ntfPushes())->toHaveCount(1);
    })->with([
        'off' => [['enabled' => false]],
        'moved' => [['from' => '01:00', 'to' => '06:00']],
    ]);

    it('marks only the moderation decision urgent (M2.6, ADR-192); the appeal result joins it in Phase 3', function () {
        expect(array_values(array_filter(NotificationType::cases(), fn (NotificationType $type): bool => $type->isUrgent())))->toBe([NotificationType::ModerationDecision]);
    });
});

describe('preferences', function () {
    it('skips the push of a type the member switched off, keeps the row', function () {
        ntfPushOn($this->lena);
        $this->lena->forceFill(['notification_prefs' => ['types' => ['new_follower' => ['push' => false]]]])->save();

        expect($this->notifier->newFollower($this->lena->refresh(), $this->lukas))->not->toBeNull()
            ->and(ntfPushes())->toBe([]);
    });

    it('queues nothing for a member without push tokens', function () {
        config(['speedclub.push.enabled' => true]);
        Queue::fake();

        $this->notifier->newFollower($this->lena, $this->lukas);

        Queue::assertNotPushed(SendPushNotification::class);
    });
});

describe('what triggers notifications', function () {
    it('tells a member about a new follower once, through the follow action', function () {
        app(FollowMember::class)->handle($this->lukas, $this->lena);
        app(FollowMember::class)->handle($this->lukas, $this->lena);

        expect(ntfRows($this->lena))->toBe(1);
    });

    it('tells followers about a first publish as public, after the commit, in slices', function () {
        config(['speedclub.notifications.fanout_chunk' => 2]);
        $followers = collect(range(1, 5))->map(fn (int $i) => ntfMember("fan$i"));
        $followers->each(fn (User $fan) => socFollow($fan, $this->lukas));
        $draft = completeDraft($this->lukas);

        $this->actingAs($this->lukas, 'sanctum')->postJson("/api/v1/vehicles/{$draft->id}/publish")->assertOk();

        $followers->each(fn (User $fan) => expect(ntfRows($fan))->toBe(1));
        expect(Notification::query()->where('type', 'followed_published')->pluck('vehicle_id')->unique()->all())->toBe([$draft->id]);
    });

    it('stays quiet about a build published as unlisted or private', function (string $visibility) {
        socFollow($this->lena, $this->lukas);
        $draft = completeDraft($this->lukas);

        $this->actingAs($this->lukas, 'sanctum')->postJson("/api/v1/vehicles/{$draft->id}/publish", ['visibility' => $visibility])->assertOk();

        expect(ntfRows($this->lena))->toBe(0);
    })->with(['unlisted', 'private']);

    it('tells followers about a new entry of Verlauf once, not about changes joining it within the window', function () {
        seedModSchema();
        socFollow($this->lena, $this->lukas);
        $vehicle = publishedVehicle($this->lukas);
        $save = app(SaveModification::class);

        $save->add($vehicle, modCategory('exhaust'), ['title' => 'Akrapovič Evolution', 'status' => ModStatus::Installed, 'fields' => []]);
        $save->add($vehicle, modCategory('exhaust'), ['title' => 'Akrapovič Slip-On', 'status' => ModStatus::Installed, 'fields' => []]);

        $row = Notification::query()->where('notifiable_id', $this->lena->id)->sole();
        expect($row->data['update_ids'] ?? [])->toHaveCount(1)
            ->and($row->data['kind'] ?? null)->toBe('update');
    });

    it('drops a publication that went private before the job ran', function () {
        socFollow($this->lena, $this->lukas);
        $vehicle = publishedVehicle($this->lukas);
        $vehicle->forceFill(['visibility' => 'private'])->save();

        (new NotifyFollowersOfPublication($this->lukas->id, $vehicle->id, ''))->handle($this->notifier);
        $hidden = ntfUpdate(publishedVehicle($this->lukas), hidden: true);
        (new NotifyFollowersOfPublication($this->lukas->id, $hidden->vehicle_id, $hidden->id))->handle($this->notifier);

        expect(ntfRows($this->lena))->toBe(0);
    });

    it('writes the security row and mail on a sign-in from a new device', function () {
        $member = ntfMember('anna.gti', ['email' => 'anna@example.de', 'password' => 'Lackierung-92-rot']);
        $signIn = fn (string $device) => $this->postJson('/api/v1/auth/login', [
            'email' => 'anna@example.de', 'password' => 'Lackierung-92-rot', 'device_name' => 'Pixel 9', 'platform' => 'android', 'app_version' => '0.1.0', 'device_id' => $device,
        ])->assertOk();

        $signIn('6f1c2b0e-8d4a-4f7e-9a51-0c3e1d2b4a01');
        expect(ntfRows($member))->toBe(0);

        app('auth')->forgetGuards();
        $signIn('0b9e7d55-21c4-4a8f-b6e2-7f3a9c1d5e02');

        $row = Notification::query()->where('notifiable_id', $member->id)->sole();
        expect($row->type)->toBe(NotificationType::Security)
            ->and($row->data)->toMatchArray(['event' => 'new_device', 'device_name' => 'Pixel 9'])
            ->and($row->data['security_event_id'] ?? null)->toBeString();
        Mail::assertSent(SecurityNoticeMail::class, 1);
    });
});
