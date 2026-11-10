<?php

use App\Enums\NotificationType;
use App\Mail\HuAuReminderMail;
use App\Models\FeatureFlag;
use App\Models\Notification;
use App\Models\QrCode;
use App\Models\QrScanDaily;
use App\Models\User;
use App\Services\Garage\HuAuReminders;
use App\Services\Notifications\QrMilestones;
use App\Services\Qr\QrCodes;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/SignatureTestHelpers.php';
require_once __DIR__.'/../Notifications/NotificationTestHelpers.php';

/**
 * M2.7 [SIG] QR scan milestones and the HU/AU reminder (02_PRODUCT_SPEC §5, §7; m2.7-contract §1): once each, through the Notifier.
 */
beforeEach(function () {
    Mail::fake();
    $this->owner = User::factory()->create(['username' => 'finn.jdm', 'locale' => 'de']);
    $this->vehicle = publishedVehicle($this->owner);
    $this->qr = app(QrCodes::class)->ensureActive($this->vehicle);
});

function sigScans(QrCode $qr, int $count, string $day = '2026-11-01'): void
{
    QrScanDaily::factory()->create(['qr_code_id' => $qr->id, 'day' => $day, 'count' => $count]);
}

function sigRowsOf(User $user, NotificationType $type): mixed
{
    return Notification::query()->where('notifiable_id', $user->id)->where('type', $type->value)->get();
}

describe('QR scan milestones', function () {
    beforeEach(fn () => sigFlag('sig.qr_stats'));

    it('keeps the milestones of the spec, which the daily query spells out', function () {
        expect(QrMilestones::MILESTONES)->toBe([10, 50, 100, 500, 1000])
            ->and(QrMilestones::reached(499))->toBe([10, 50, 100])
            ->and(QrMilestones::reached(9))->toBe([]);
    });

    it('tells the owner the highest milestone reached, once, over all the vehicle\'s codes', function () {
        $old = QrCode::factory()->revoked()->create(['vehicle_id' => $this->vehicle->id]);
        sigScans($old, 30, '2026-10-01');
        sigScans($this->qr, 25);

        expect(app(QrMilestones::class)->run())->toBe(1);

        $rows = sigRowsOf($this->owner, NotificationType::QrMilestone);
        expect($rows)->toHaveCount(1)
            ->and($rows[0]->data)->toBe(['milestone' => 50])
            ->and($rows[0]->vehicle_id)->toBe($this->vehicle->id)
            ->and($this->vehicle->refresh()->qr_milestone)->toBe(50);

        // Again, and after the row was pruned: nothing new.
        expect(app(QrMilestones::class)->run())->toBe(0);
        Notification::query()->delete();
        expect(app(QrMilestones::class)->run())->toBe(0)->and(sigRowsOf($this->owner, NotificationType::QrMilestone))->toHaveCount(0);

        // The next milestone gets its own row.
        sigScans($this->qr, 60, '2026-11-02');
        expect(app(QrMilestones::class)->run())->toBe(1)
            ->and(sigRowsOf($this->owner, NotificationType::QrMilestone)->first()->data)->toBe(['milestone' => 100]);
    });

    it('stays silent below 10 scans, for drafts, deleted vehicles and while the flag is off', function () {
        sigScans($this->qr, 9);
        $deleted = publishedVehicle(User::factory()->create());
        sigScans(app(QrCodes::class)->ensureActive($deleted), 500);
        $deleted->delete();

        expect(app(QrMilestones::class)->run())->toBe(0);

        sigScans($this->qr, 1, '2026-11-02');
        sigFlag('sig.qr_stats', false);
        // FeatureFlags keeps a flag for the rest of the request; this test is one request.
        request()->attributes->remove('speedclub.flags');
        expect(app(QrMilestones::class)->run())->toBeNull()
            ->and(sigRowsOf($this->owner, NotificationType::QrMilestone))->toHaveCount(0);
    });

    it('pushes only when the owner switched it on (off by default)', function () {
        ntfPushOn($this->owner);
        sigScans($this->qr, 12);
        $this->travelTo(CarbonImmutable::parse('2026-11-03 09:00', 'Europe/Berlin'));

        app(QrMilestones::class)->run();
        expect(ntfPushes())->toBe([]);

        $this->owner->forceFill(['notification_prefs' => ['types' => ['qr_milestone' => ['push' => true]]]])->save();
        sigScans($this->qr, 40, '2026-11-02');
        app(QrMilestones::class)->run();

        expect(ntfPushes())->toHaveCount(1)
            ->and(json_encode(ntfPushes()[0]))->toContain('50-mal gescannt');
    });

    it('shows on HOME-02 with its milestone and the vehicle', function () {
        sigScans($this->qr, 10);
        app(QrMilestones::class)->run();
        Sanctum::actingAs($this->owner);

        $row = collect($this->getJson('/api/v1/notifications')->assertOk()->json('data'))->firstWhere('type', 'qr_milestone');

        expect($row['details'])->toBe(['milestone' => 10])
            ->and($row['vehicle']['id'])->toBe($this->vehicle->id)
            ->and($row['actors'])->toBe([]);
    });

    it('lists the reached milestones in qr/stats', function () {
        sigScans($this->qr, 120);
        Sanctum::actingAs($this->owner);

        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/qr/stats")->assertOk()
            ->assertJsonPath('data.total', 120)
            ->assertJsonPath('data.milestones_reached', [10, 50, 100]);
    });
});

describe('HU/AU reminder', function () {
    beforeEach(function () {
        sigFlag('sig.hu_au_reminder');
        $this->today = CarbonImmutable::parse('2027-01-30', 'Europe/Berlin');
    });

    it('saves the due month through PATCH vehicles/{id}, owner only and never public', function () {
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}", ['hu_au_due' => '2027-03'])->assertOk()->assertJsonPath('data.hu_au_due', '2027-03');
        $this->patchJson("/api/v1/vehicles/{$this->vehicle->id}", ['hu_au_due' => '03/2027'])->assertUnprocessable()->assertJsonValidationErrors('hu_au_due');

        Sanctum::actingAs(User::factory()->create());
        $this->getJson("/api/v1/vehicles/{$this->vehicle->id}")->assertOk()->assertJsonPath('data.hu_au_due', null);
        $this->getJson("/api/v1/public/vehicles/{$this->vehicle->slug}")->assertOk()->assertJsonMissingPath('data.hu_au_due');
    });

    it('reminds 30 days before the due month starts, once per due date', function () {
        $this->vehicle->forceFill(['hu_au_due' => '2027-03-01'])->save();

        // 31 days before: not yet.
        expect(app(HuAuReminders::class)->run($this->today->subDay()))->toBe(0)
            ->and(app(HuAuReminders::class)->run($this->today))->toBe(1)
            ->and(app(HuAuReminders::class)->run($this->today))->toBe(0)
            ->and(app(HuAuReminders::class)->run($this->today->addDays(20)))->toBe(0);

        $rows = sigRowsOf($this->owner, NotificationType::HuAuReminder);
        expect($rows)->toHaveCount(1)->and($rows[0]->data)->toBe(['due' => '2027-03'])
            ->and($this->vehicle->refresh()->hu_au_reminded_for?->toDateString())->toBe('2027-03-01');

        // A new due date gets its own reminder.
        $this->vehicle->forceFill(['hu_au_due' => '2029-03-01'])->save();
        expect(app(HuAuReminders::class)->run(CarbonImmutable::parse('2029-01-30')))->toBe(1)
            ->and(sigRowsOf($this->owner, NotificationType::HuAuReminder))->toHaveCount(2);
    });

    it('catches up a missed day until the due month ends, but never reminds of a month already over', function () {
        $this->vehicle->forceFill(['hu_au_due' => '2027-03-01'])->save();
        $late = publishedVehicle(User::factory()->create());
        $late->forceFill(['hu_au_due' => '2027-02-01'])->save();

        expect(app(HuAuReminders::class)->run(CarbonImmutable::parse('2027-03-31')))->toBe(1)
            ->and(sigRowsOf($late->owner, NotificationType::HuAuReminder))->toHaveCount(0);
    });

    it('pushes by default and e-mails only when switched on, in the owner\'s language', function () {
        $this->travelTo(CarbonImmutable::parse('2027-01-30 09:00', 'Europe/Berlin'));
        ntfPushOn($this->owner);
        $this->vehicle->forceFill(['hu_au_due' => '2027-03-01'])->save();

        app(HuAuReminders::class)->run($this->today);

        expect(ntfPushes())->toHaveCount(1)->and(json_encode(ntfPushes()[0], JSON_UNESCAPED_UNICODE))->toContain('im März 2027 fällig');
        Mail::assertNothingSent();

        $other = publishedVehicle(User::factory()->create(['locale' => 'en', 'notification_prefs' => ['types' => ['hu_au_reminder' => ['email' => true]]]]));
        $other->forceFill(['hu_au_due' => '2027-03-01'])->save();
        app(HuAuReminders::class)->run($this->today);

        Mail::assertSent(HuAuReminderMail::class, fn (HuAuReminderMail $mail): bool => $mail->hasTo($other->owner->email) && $mail->due === '2027-03');
        $mail = new HuAuReminderMail('Skyline GT-R R34', '2027-03', $other->id);
        expect($mail->locale('en')->render())->toContain('March 2027')->toContain('/app/garage/'.$other->id.'/specs')
            ->and((new HuAuReminderMail('Skyline GT-R R34', '2027-03', $other->id))->locale('de')->render())->toContain('März 2027');
    });

    it('does nothing while the flag is off, and nothing for a suspended owner', function () {
        $this->vehicle->forceFill(['hu_au_due' => '2027-03-01'])->save();
        FeatureFlag::query()->where('key', 'sig.hu_au_reminder')->update(['enabled' => false]);
        request()->attributes->remove('speedclub.flags');

        expect(app(HuAuReminders::class)->run($this->today))->toBeNull();

        sigFlag('sig.hu_au_reminder');
        request()->attributes->remove('speedclub.flags');
        $this->owner->forceFill(['status' => 'suspended'])->save();
        app(HuAuReminders::class)->run($this->today);

        expect(sigRowsOf($this->owner, NotificationType::HuAuReminder))->toHaveCount(0);
    });

    it('opens GAR-06 from HOME-02', function () {
        $this->vehicle->forceFill(['hu_au_due' => '2027-03-01'])->save();
        app(HuAuReminders::class)->run($this->today);
        Sanctum::actingAs($this->owner);

        $row = collect($this->getJson('/api/v1/notifications')->assertOk()->json('data'))->firstWhere('type', 'hu_au_reminder');
        expect($row['details'])->toBe(['due' => '2027-03'])->and($row['vehicle']['id'])->toBe($this->vehicle->id);
    });
});

it('runs both daily at 09:00 Europe/Berlin', function (string $command) {
    $event = collect(app(Schedule::class)->events())->first(fn ($event): bool => str_contains((string) $event->command, $command));

    expect($event)->not->toBeNull()
        ->and($event->expression)->toBe('0 9 * * *')
        ->and($event->timezone)->toBe('Europe/Berlin');

    $this->artisan($command)->assertSuccessful();
})->with(['qr:milestones', 'vehicles:hu-au-reminders']);
