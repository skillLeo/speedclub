<?php

use App\Enums\MaintenanceType;
use App\Enums\NotificationType;
use App\Mail\HuAuReminderMail;
use App\Mail\MaintenanceDueMail;
use App\Models\FeatureFlag;
use App\Models\MaintenanceReminder;
use App\Models\Notification;
use App\Models\User;
use App\Services\Garage\HuAuReminders;
use App\Services\Maintenance\MaintenanceReminders;
use App\Services\Maintenance\MaintenanceSchedule;
use App\Services\Maintenance\MaintenanceTexts;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Mail;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/MaintenanceTestHelpers.php';
require_once __DIR__.'/../Notifications/NotificationTestHelpers.php';

/**
 * M4.13 reminders (09 §8.8): the server is the source of truth, once per stage, with the deterministic keys the app's local backups use;
 * SET-09 "Fälligkeiten" (push, e-mail) and SET-23 switches; the M2.7 HU/AU reminder stays silent while `maintenance` is on.
 */
beforeEach(function () {
    Mail::fake();
    mntFlags();
    $this->owner = User::factory()->create(['username' => 'finn.jdm', 'locale' => 'de']);
    $this->vehicle = publishedVehicle($this->owner);
    $this->today = CarbonImmutable::parse('2027-02-01');
});

function mntRows(User $user): mixed
{
    return Notification::query()->where('notifiable_id', $user->id)->where('type', NotificationType::MaintenanceDue->value)->get();
}

it('sends each date stage once, on its day, and passes over longer ones that were missed', function () {
    $item = mntItem($this->vehicle, MaintenanceType::HuAu, ['next_due_at' => '2027-03-01', 'due_pinned' => true, 'lead_days' => [30, 14, 1], 'next_due_km' => null]);
    $reminders = app(MaintenanceReminders::class);

    expect($reminders->run(CarbonImmutable::parse('2027-01-29')))->toBe(0)
        ->and($reminders->run(CarbonImmutable::parse('2027-01-30')))->toBe(1)
        ->and($reminders->run(CarbonImmutable::parse('2027-01-30')))->toBe(0)
        // 14 and 1 day before, both missed until the last day of February: only the 1-day stage goes, the 14-day one is passed over.
        ->and($reminders->run(CarbonImmutable::parse('2027-02-28')))->toBe(1);

    $rows = mntRows($this->owner);
    expect($rows)->toHaveCount(2)
        ->and($rows->pluck('group_key')->sort()->values()->all())->toBe(["mnt:{$item->id}:d2027-03-01:1", "mnt:{$item->id}:d2027-03-01:30"])
        ->and(MaintenanceReminder::query()->where('reminder_key', "mnt:{$item->id}:d2027-03-01:14")->value('sent_at'))->toBeNull();

    $stages = collect($reminders->stages($item->fresh(), CarbonImmutable::parse('2027-02-28')))->pluck('status', 'lead_days')->all();
    expect($stages)->toBe([30 => 'sent', 14 => 'skipped', 1 => 'sent']);
});

it('sends the km stage once the odometer is within 1,000 km', function () {
    mntItem($this->vehicle, MaintenanceType::OilChange, ['next_due_at' => null, 'next_due_km' => 60000, 'lead_days' => [14]]);
    $this->vehicle->forceFill(['odometer_km' => 58000])->save();

    expect(app(MaintenanceReminders::class)->run($this->today))->toBe(0);
    $this->vehicle->forceFill(['odometer_km' => 59100])->save();
    expect(app(MaintenanceReminders::class)->run($this->today))->toBe(1)
        ->and(app(MaintenanceReminders::class)->run($this->today))->toBe(0)
        ->and(mntRows($this->owner)->first()?->data['kind'])->toBe('km');
});

it('stays silent for switched-off items, SET-23 switches, sample builds, deleted vehicles and inactive owners', function () {
    $due = ['next_due_at' => '2027-02-10', 'next_due_km' => null, 'lead_days' => [14]];
    mntItem($this->vehicle, MaintenanceType::OilChange, [...$due, 'enabled' => false]);
    mntItem($this->vehicle, MaintenanceType::TyreChange, $due);
    $this->owner->forceFill(['maintenance_prefs' => ['tyre_reminders' => false]])->save();

    $sample = publishedVehicle(User::factory()->create(), ['is_sample' => true]);
    mntItem($sample, MaintenanceType::OilChange, $due);
    $deleted = publishedVehicle(User::factory()->create());
    mntItem($deleted, MaintenanceType::OilChange, $due);
    $deleted->delete();
    $suspended = publishedVehicle(User::factory()->suspended()->create());
    mntItem($suspended, MaintenanceType::OilChange, $due);

    expect(app(MaintenanceReminders::class)->run($this->today))->toBe(0)
        ->and(Notification::query()->where('type', NotificationType::MaintenanceDue->value)->count())->toBe(0);
});

it('pushes with the reminder key and the MNT-01 path, and mails only when "Fälligkeiten" e-mails are on', function () {
    ntfPushOn($this->owner);
    $this->owner->forceFill(['notification_prefs' => ['quiet_hours' => ['enabled' => false]]])->save();
    $item = mntItem($this->vehicle, MaintenanceType::OilChange, ['next_due_at' => '2027-02-10', 'next_due_km' => null, 'lead_days' => [14]]);
    app(MaintenanceReminders::class)->run($this->today);

    $key = "mnt:{$item->id}:d2027-02-10:14";
    expect(mntRows($this->owner)->sole()->data['reminder_key'])->toBe($key);
    $message = ntfPushes()[0][0] ?? [];
    expect($message['data']['reminder_key'] ?? null)->toBe($key)
        ->and($message['data']['type'] ?? null)->toBe('maintenance_due')
        ->and($message['data']['path'] ?? null)->toBe("/garage/{$this->vehicle->id}/maintenance?item={$item->id}")
        ->and($message['body'] ?? null)->toContain('Ölwechsel');
    Mail::assertNothingSent();

    $other = User::factory()->create(['locale' => 'en', 'notification_prefs' => ['types' => ['hu_au_reminder' => ['email' => true]]]]);
    mntItem(publishedVehicle($other), MaintenanceType::BrakeFluid, ['next_due_at' => '2027-02-10', 'next_due_km' => null, 'lead_days' => [14]]);
    app(MaintenanceReminders::class)->run($this->today);
    Mail::assertSent(MaintenanceDueMail::class, fn (MaintenanceDueMail $mail): bool => $mail->hasTo($other->email) && str_contains($mail->sentence, 'brake fluid'));
});

it('writes the push text in the owner\'s language and distance unit', function (string $locale, string $unit, MaintenanceType $type, array $data, string $expected) {
    $this->owner->forceFill(['locale' => $locale, 'distance_unit' => $unit])->save();
    $text = app(MaintenanceTexts::class)->sentence(['item_type' => $type->value, ...$data], 'BMW M3', $this->owner, $locale);

    expect($text)->toBe($expected);
})->with([
    'oil, de' => ['de', 'km', MaintenanceType::OilChange, ['kind' => 'date', 'due_on' => '2027-06-14', 'lead_days' => 14], 'Der Ölwechsel für BMW M3 ist am 14. Juni 2027 fällig.'],
    'HU/AU, de' => ['de', 'km', MaintenanceType::HuAu, ['kind' => 'date', 'due_on' => '2027-03-01', 'lead_days' => 30], 'Die HU/AU für BMW M3 ist im März 2027 fällig.'],
    'km, en in miles' => ['en', 'mi', MaintenanceType::Service, ['kind' => 'km', 'due_km' => 120000], "The service for BMW M3 is due at 74,565\u{00A0}mi."],
    'winter tyres, de' => ['de', 'km', MaintenanceType::TyreChange, ['kind' => 'date', 'due_on' => '2027-10-15', 'lead_days' => 14], 'Von O bis O: Zeit für Winterreifen an BMW M3. Reifenwechsel bis 15. Oktober 2027.'],
    'custom, de' => ['de', 'km', MaintenanceType::Custom, ['kind' => 'date', 'due_on' => '2027-05-01', 'lead_days' => 14, 'title' => 'Zahnriemen'], '„Zahnriemen“ für BMW M3 ist am 1. Mai 2027 fällig.'],
]);

it('keeps the M2.7 HU/AU reminder silent while maintenance is on and lets it run while it is off', function () {
    FeatureFlag::query()->updateOrCreate(['key' => 'sig.hu_au_reminder'], ['enabled' => true, 'description' => 'x']);
    request()->attributes->remove('speedclub.flags');
    $this->vehicle->forceFill(['hu_au_due' => '2027-03-01'])->save();

    expect(app(HuAuReminders::class)->run(CarbonImmutable::parse('2027-01-30', 'Europe/Berlin')))->toBeNull();

    mntFlags(['maintenance' => false]);
    expect(app(MaintenanceReminders::class)->run(CarbonImmutable::parse('2027-01-30')))->toBe(1);
    Mail::assertNotSent(HuAuReminderMail::class);
    expect(Notification::query()->where('type', NotificationType::HuAuReminder->value)->count())->toBe(1);
});

it('runs daily at 09:00 Europe/Berlin', function () {
    $event = collect(app(Schedule::class)->events())->first(fn ($event): bool => str_contains((string) $event->command, 'maintenance:reminders'));

    expect($event)->not->toBeNull()->and($event->expression)->toBe('0 9 * * *')->and($event->timezone)->toBe('Europe/Berlin');
    $this->artisan('maintenance:reminders')->assertSuccessful();
});

it('hands the app its reminder plan: planned stages with their push time, and what the server already did', function () {
    $item = mntItem($this->vehicle, MaintenanceType::OilChange, ['next_due_at' => now()->addDays(20)->toDateString(), 'next_due_km' => 60000, 'lead_days' => [14, 1]]);
    mntItem(publishedVehicle(User::factory()->create()), MaintenanceType::OilChange, ['next_due_at' => now()->addDays(20)->toDateString()]);
    Sanctum::actingAs($this->owner);

    $plan = $this->getJson('/api/v1/me/maintenance/reminders')->assertOk()->assertJsonPath('data.timezone', 'Europe/Berlin')->json('data.stages');
    // The key carries the stored due date; reading it from Berlin's clock failed between 00:00 and 01:00 Berlin, when UTC is a day behind.
    $due = (string) $item->fresh()?->next_due_at?->toDateString();

    expect(collect($plan)->pluck('key')->all())->toEqualCanonicalizing(["mnt:{$item->id}:d{$due}:14", "mnt:{$item->id}:d{$due}:1", "mnt:{$item->id}:k60000"])
        ->and(collect($plan)->firstWhere('lead_days', 14)['fire_at'])->toEndWith('09:00:00+01:00')
        ->and(collect($plan)->firstWhere('kind', 'km')['fire_at'])->toBeNull()
        ->and(collect($plan)->pluck('status')->unique()->all())->toBe(['planned']);
});

it('computes Easter, the tyre seasons, the insurance Stichtag and the HU/AU deadline', function () {
    expect(MaintenanceSchedule::easter(2027)->toDateString())->toBe('2027-03-28')
        ->and(MaintenanceSchedule::easter(2026)->toDateString())->toBe('2026-04-05')
        ->and(MaintenanceSchedule::summerTyres(2027)->toDateString())->toBe('2027-04-11');

    $tyres = mntItem($this->vehicle, MaintenanceType::TyreChange, ['last_done_at' => '2026-04-20']);
    $insurance = mntItem($this->vehicle, MaintenanceType::Insurance, ['last_done_at' => null]);
    $hu = mntItem($this->vehicle, MaintenanceType::HuAu, ['next_due_at' => '2027-03-01', 'due_pinned' => true]);
    $schedule = app(MaintenanceSchedule::class);
    $today = CarbonImmutable::parse('2026-09-01');

    expect($schedule->nextDueAt($tyres, $today)?->toDateString())->toBe('2026-10-15')
        ->and($schedule->nextDueAt($insurance, $today)?->toDateString())->toBe('2026-11-30')
        // An unlogged season rolls on 30 days after its date.
        ->and($schedule->nextDueAt($tyres, CarbonImmutable::parse('2026-11-20'))?->toDateString())->toBe('2027-04-11')
        ->and($schedule->deadline($hu)?->toDateString())->toBe('2027-03-31')
        ->and($schedule->state($hu, null, CarbonImmutable::parse('2027-03-20'))->value)->toBe('soon')
        ->and($schedule->state($hu, null, CarbonImmutable::parse('2027-04-01'))->value)->toBe('overdue');
});
