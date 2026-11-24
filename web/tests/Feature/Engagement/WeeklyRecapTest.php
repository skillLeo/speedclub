<?php

use App\Enums\NotificationType;
use App\Enums\RecapStatus;
use App\Enums\ViewSource;
use App\Http\Controllers\Web\EmailUnsubscribeController;
use App\Jobs\Engagement\SendWeeklyRecapMail;
use App\Mail\WeeklyRecapMail;
use App\Models\Follow;
use App\Models\Notification;
use App\Models\PushToken;
use App\Models\QrCode;
use App\Models\QrScanDaily;
use App\Models\User;
use App\Models\ViewDay;
use App\Models\WeeklyRecap;
use App\Services\Auth\AuthMailer;
use App\Services\Engagement\WeeklyRecaps;
use App\Services\Notifications\NotificationPrefs;
use App\Services\Notifications\NotificationTexts;
use App\Services\Notifications\SendPushNotification;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;

require_once __DIR__.'/EngagementTestHelpers.php';

/**
 * M5.7 weekly recap (10 §6.3, m5.7-contract §6): Sunday 18:00 Europe/Berlin, push first, the e-mail only when no push went out (D-1),
 * skipped when nothing happened (Treffen alone never make a recap), once per member and week, one-click unsubscribe (GET asks, POST acts).
 */
beforeEach(function () {
    Queue::fake([SendPushNotification::class, SendWeeklyRecapMail::class]);
    engFlag(true, 'weekly_recap');
    config(['speedclub.push.enabled' => true]);
    $this->travelTo(CarbonImmutable::parse('2026-11-22 18:00', 'Europe/Berlin'));
    $this->member = User::factory()->create(['locale' => 'de']);
});

function engRecap(): ?int
{
    return app(WeeklyRecaps::class)->run();
}

function engViewsThisWeek(User $member, int $views, string $day = '2026-11-19'): void
{
    ViewDay::factory()->forProfile($member)->create(['day' => $day, 'views' => $views, 'source' => ViewSource::Web]);
}

it('sends the week by push when the member has a device, with the non-zero numbers', function () {
    PushToken::factory()->create(['user_id' => $this->member->id]);
    $car = publishedVehicle($this->member);
    engViewsThisWeek($this->member, 128);
    engViewsThisWeek($this->member, 40, '2026-11-15'); // last week: not in this recap
    QrScanDaily::factory()->create(['qr_code_id' => QrCode::factory()->create(['vehicle_id' => $car->id])->id, 'day' => '2026-11-20', 'count' => 14]);
    Follow::factory()->count(3)->create(['followee_id' => $this->member->id, 'created_at' => now()->subDay()]);

    engRecap();

    // The three followers are members too: their weeks were empty, so they got nothing.
    expect(WeeklyRecap::query()->where('user_id', '!=', $this->member->id)->pluck('status')->unique()->all())->toBe([RecapStatus::Skipped]);

    $recap = WeeklyRecap::query()->where('user_id', $this->member->id)->sole();
    expect($recap->status)->toBe(RecapStatus::Sent)
        ->and($recap->channels)->toBe(['push'])
        ->and($recap->payload)->toMatchArray(['views' => 128, 'sticker_scans' => 14, 'new_followers' => 3, 'spots' => 0]);

    $row = Notification::query()->where('type', NotificationType::WeeklyRecap)->sole();
    $push = app(NotificationTexts::class)->push($row, $this->member);

    expect($row->pushed_at)->not->toBeNull()
        ->and($push)->toBe(['title' => 'Deine Woche bei Speedclub', 'body' => '128 Aufrufe · 14 Sticker-Scans · 3 neue Follower'])
        ->and(app(NotificationTexts::class)->path($row))->toBe('/insights');
    Queue::assertPushed(SendPushNotification::class, 1);
    Queue::assertNotPushed(SendWeeklyRecapMail::class);
});

it('falls back to e-mail when no push reaches the member: no device, push switched off, quiet hours, or the weekly cap', function (Closure $setup) {
    $setup($this);
    engViewsThisWeek($this->member, 5);

    engRecap();

    expect(WeeklyRecap::query()->sole()->channels)->toBe(['email'])
        ->and(Notification::query()->where('type', NotificationType::WeeklyRecap)->sole()->pushed_at)->toBeNull();
    Queue::assertPushed(SendWeeklyRecapMail::class, fn (SendWeeklyRecapMail $job): bool => $job->recapId === WeeklyRecap::query()->sole()->id);
    Queue::assertNotPushed(SendPushNotification::class);
})->with([
    'no device' => [fn () => null],
    'push switched off' => [function ($test): void {
        PushToken::factory()->create(['user_id' => $test->member->id]);
        $test->member->forceFill(['notification_prefs' => ['types' => ['weekly_recap' => ['push' => false]]]])->save();
    }],
    'own quiet hours from 17:00' => [function ($test): void {
        PushToken::factory()->create(['user_id' => $test->member->id]);
        $test->member->forceFill(['notification_prefs' => ['quiet_hours' => ['enabled' => true, 'from' => '17:00', 'to' => '08:00']]])->save();
    }],
    'three engagement pushes used' => [function ($test): void {
        PushToken::factory()->create(['user_id' => $test->member->id]);

        foreach ([1, 2, 3] as $slot) {
            DB::table('engagement_push_claims')->insert(['user_id' => $test->member->id, 'week' => '2026-11-16', 'slot' => $slot, 'type' => 'spot_alert', 'notification_id' => null, 'created_at' => now()]);
        }
    }],
]);

it('never pushes at night: a run after 22:00 sends the e-mail instead', function () {
    PushToken::factory()->create(['user_id' => $this->member->id]);
    $this->member->forceFill(['notification_prefs' => ['quiet_hours' => ['enabled' => false]]])->save();
    engViewsThisWeek($this->member, 5);
    $this->travelTo(CarbonImmutable::parse('2026-11-22 22:30', 'Europe/Berlin'));

    engRecap();

    expect(WeeklyRecap::query()->sole()->channels)->toBe(['email']);
    Queue::assertNotPushed(SendPushNotification::class);
});

it('is unreachable without a push and with the e-mail switched off, the row in the app list all the same', function () {
    $this->member->forceFill(['notification_prefs' => ['types' => ['weekly_recap' => ['email' => false]]]])->save();
    engViewsThisWeek($this->member, 5);

    engRecap();

    expect(WeeklyRecap::query()->sole()->status)->toBe(RecapStatus::Unreachable)
        ->and(Notification::query()->where('type', NotificationType::WeeklyRecap)->count())->toBe(1);
    Queue::assertNothingPushed();
});

it('skips a week in which nothing happened — also when only Treffen are coming up', function () {
    PushToken::factory()->create(['user_id' => $this->member->id]);

    engRecap();

    expect(WeeklyRecap::query()->sole()->status)->toBe(RecapStatus::Skipped)
        ->and(Notification::query()->count())->toBe(0)
        ->and(WeeklyRecaps::nothingHappened(['views' => 0, 'sticker_scans' => 0, 'new_followers' => 0, 'spots' => 0, 'events_nearby' => 4, 'maintenance_due' => 0]))->toBeTrue()
        ->and(WeeklyRecaps::nothingHappened(['views' => 0, 'sticker_scans' => 0, 'new_followers' => 0, 'spots' => 0, 'events_nearby' => 0, 'maintenance_due' => 1]))->toBeFalse();
    Queue::assertNothingPushed();
});

it('never sends twice in a week, and resumes where a cut-off run stopped', function () {
    PushToken::factory()->create(['user_id' => $this->member->id]);
    $other = User::factory()->create();
    PushToken::factory()->create(['user_id' => $other->id]);
    engViewsThisWeek($this->member, 5);
    engViewsThisWeek($other, 5);

    config(['speedclub.weekly_recap.chunk' => 1, 'speedclub.weekly_recap.seconds' => 0]);
    expect(engRecap())->toBe(1);

    config(['speedclub.weekly_recap.seconds' => 40]);
    expect(engRecap())->toBe(1)
        ->and(engRecap())->toBe(0)
        ->and(WeeklyRecap::query()->count())->toBe(2);
    Queue::assertPushed(SendPushNotification::class, 2);
});

it('leaves out members who switched every channel off, samples, unverified and suspended members, and everybody while the flag is off', function () {
    $off = User::factory()->create(['notification_prefs' => ['types' => ['weekly_recap' => ['push' => false, 'web_push' => false, 'email' => false]]]]);
    $sample = User::factory()->create(['is_sample' => true]);
    $unverified = User::factory()->unverified()->create();
    $suspended = User::factory()->suspended()->create();

    foreach ([$off, $sample, $unverified, $suspended] as $member) {
        engViewsThisWeek($member, 10);
    }

    engRecap();
    expect(WeeklyRecap::query()->pluck('user_id')->all())->not->toContain($off->id, $sample->id, $unverified->id, $suspended->id);
});

it('sends nothing while the flag is off', function () {
    engFlag(false, 'weekly_recap');
    PushToken::factory()->create(['user_id' => $this->member->id]);
    engViewsThisWeek($this->member, 10);

    expect(engRecap())->toBe(0)->and(WeeklyRecap::query()->count())->toBe(0);
    Queue::assertNothingPushed();
});

it('mails the numbers with a one-click unsubscribe link, and asks the switch again right before sending', function () {
    Mail::fake();
    engViewsThisWeek($this->member, 7);
    engRecap();
    $job = new SendWeeklyRecapMail(WeeklyRecap::query()->sole()->id);

    $job->handle(app(AuthMailer::class), app(NotificationTexts::class));

    Mail::assertSent(WeeklyRecapMail::class, function (WeeklyRecapMail $mail): bool {
        $headers = $mail->headers()->text;

        return str_contains($headers['List-Unsubscribe'], '/abbestellen/wochenrueckblick/'.$this->member->id)
            && str_contains($headers['List-Unsubscribe'], 'signature=')
            && $headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click'
            && $mail->payload['views'] === 7;
    });

    $this->member->forceFill(['notification_prefs' => ['types' => ['weekly_recap' => ['email' => false]]]])->save();
    $job->handle(app(AuthMailer::class), app(NotificationTexts::class));
    Mail::assertSent(WeeklyRecapMail::class, 1);
});

function engRecapUnsubscribeUrl(User $member): string
{
    return EmailUnsubscribeController::url(SendWeeklyRecapMail::LIST, $member, SendWeeklyRecapMail::LINK_DAYS);
}

describe('the unsubscribe link (the shared WEB-UNSUB page of M5.6)', function () {
    it('only asks on GET (mail scanners open links) and switches only the recap e-mail off on POST, idempotently', function () {
        $url = engRecapUnsubscribeUrl($this->member);

        $this->get($url)->assertOk()->assertSee('data-step="ask"', false)->assertSee('Wochenrückblick per E-Mail abbestellen?')->assertHeader('X-Robots-Tag', 'noindex');
        expect(NotificationPrefs::for($this->member->refresh())['types']['weekly_recap']['email'])->toBeTrue();

        $this->post($url)->assertOk()->assertSee('data-step="done"', false);
        expect(NotificationPrefs::for($this->member->refresh())['types']['weekly_recap'])->toMatchArray(['email' => false, 'push' => true, 'web_push' => true])
            ->and(NotificationPrefs::for($this->member)['types']['event_nearby'])->toBe(NotificationPrefs::types()['event_nearby']);

        $this->post($url)->assertOk();
        expect(NotificationPrefs::for($this->member->refresh())['types']['weekly_recap']['email'])->toBeFalse();
    });

    it('takes the mail provider\'s one-click POST without a session or CSRF token', function () {
        $this->post(engRecapUnsubscribeUrl($this->member), ['List-Unsubscribe' => 'One-Click'])->assertOk();

        expect(NotificationPrefs::for($this->member->refresh())['types']['weekly_recap']['email'])->toBeFalse();
    });

    it('refuses a changed link and another member\'s id under the same signature', function () {
        $url = engRecapUnsubscribeUrl($this->member);
        $other = User::factory()->create();

        $this->get(str_replace('signature=', 'signature=0', $url))->assertForbidden();
        $this->post(str_replace('signature=', 'signature=0', $url))->assertForbidden();
        $this->post(str_replace($this->member->id, $other->id, $url))->assertForbidden();

        expect(NotificationPrefs::for($other->refresh())['types']['weekly_recap']['email'])->toBeTrue()
            ->and(NotificationPrefs::for($this->member->refresh())['types']['weekly_recap']['email'])->toBeTrue();
    });
});

it('lists the switches in SET-09: push, browser push and e-mail, all on by default', function () {
    expect(NotificationPrefs::defaults()['types']['weekly_recap'])->toBe(['push' => true, 'email' => true, 'web_push' => true])
        ->and(NotificationPrefs::defaults()['types']['plan_due'])->toBe(['push' => true, 'web_push' => true])
        ->and(NotificationPrefs::ENGAGEMENT_CATEGORIES)->toBe(['plan_due' => 'build_prompts', 'weekly_recap' => 'weekly_recap']);

    $this->actingAs($this->member, 'sanctum')
        ->patchJson('/api/v1/me/settings', ['notification_prefs' => ['types' => ['weekly_recap' => ['email' => false], 'plan_due' => ['push' => false]]]])
        ->assertOk()
        ->assertJsonPath('data.notification_prefs.types.weekly_recap.email', false)
        ->assertJsonPath('data.notification_prefs.types.plan_due.push', false);
});

it('is scheduled on Sundays from 18:00 to 21:55 in Germany', function () {
    foreach (['2026-11-22 18:00' => true, '2026-11-22 21:55' => true, '2026-11-22 17:55' => false, '2026-11-22 22:00' => false, '2026-11-21 18:00' => false] as $at => $due) {
        expect(engScheduledAt('recap:weekly', $at))->toBe($due, $at);
    }
});
