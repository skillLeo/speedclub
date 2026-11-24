<?php

use App\Enums\ViewSource;
use App\Models\FeatureFlag;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\ViewDay;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Schedule as ScheduleFacade;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/../Garage/GarageTestHelpers.php';

/**
 * M5.7 Engagement test helpers (m5.7-contract §14).
 */
const ENG_BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const ENG_ANDROID_APP = 'okhttp/4.12.0';

function engFlag(bool $on = true, string $key = 'insights'): void
{
    FeatureFlag::query()->updateOrCreate(['key' => $key], ['enabled' => $on, 'description' => $key]);
}

/**
 * POST views as $member (null: a guest) with a browser user agent unless $headers say otherwise.
 *
 * @param  array<string, mixed>  $body
 * @param  array<string, string>  $headers
 */
function engBeacon(?User $member, array $body, array $headers = []): TestResponse
{
    if ($member !== null) {
        Sanctum::actingAs($member);
    } else {
        app('auth')->forgetGuards();
    }

    return test()->postJson('/api/v1/views', $body, ['User-Agent' => ENG_BROWSER, ...$headers]);
}

/**
 * @param  array<string, string>  $headers
 */
function engVehicleView(?User $member, Vehicle $vehicle, string $source = 'app', array $headers = []): TestResponse
{
    return engBeacon($member, ['subject' => 'vehicle', 'id' => $vehicle->id, 'source' => $source], $headers);
}

/**
 * The views counted for the vehicle per source (sum over days).
 *
 * @return array<string, int>
 */
function engVehicleViews(Vehicle $vehicle): array
{
    return ViewDay::query()->where('vehicle_id', $vehicle->id)->get()
        ->groupBy(fn (ViewDay $day): string => $day->source->value)
        ->map(fn ($days): int => (int) $days->sum('views'))
        ->all();
}

/**
 * @return array<string, int>
 */
function engProfileViews(User $member): array
{
    return ViewDay::query()->where('subject_type', 'profile')->where('subject_id', $member->id)->get()
        ->groupBy(fn (ViewDay $day): string => $day->source->value)
        ->map(fn ($days): int => (int) $days->sum('views'))
        ->all();
}

/**
 * Daily totals for $vehicle: $daysAgo => views (Europe/Berlin days back from now).
 *
 * @param  array<int, int>  $views
 */
function engSeedVehicleDays(Vehicle $vehicle, array $views, ViewSource $source = ViewSource::App): void
{
    foreach ($views as $ago => $count) {
        ViewDay::factory()->forVehicle($vehicle)->create([
            'day' => CarbonImmutable::now('Europe/Berlin')->subDays($ago)->toDateString(),
            'source' => $source,
            'views' => $count,
        ]);
    }
}

/**
 * Whether the scheduled command $needle would run at $at (Europe/Berlin). The schedule is defined again at that moment: between() takes
 * "now" when the entry is defined (on each real `schedule:run` that is the minute it runs), so a schedule built before travelTo() would
 * test the wrong minute.
 */
function engScheduledAt(string $needle, string $at): bool
{
    test()->travelTo(CarbonImmutable::parse($at, 'Europe/Berlin'));
    $schedule = new Schedule;
    app()->instance(Schedule::class, $schedule);
    ScheduleFacade::clearResolvedInstance(Schedule::class);
    require base_path('routes/console.php');

    $event = collect($schedule->events())->first(fn ($event): bool => str_contains((string) $event->command, $needle));

    return $event !== null && $event->timezone === 'Europe/Berlin' && $event->isDue(app()) && $event->filtersPass(app());
}
