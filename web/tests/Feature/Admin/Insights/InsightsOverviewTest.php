<?php

use App\Enums\NotificationType;
use App\Enums\RecapStatus;
use App\Enums\ViewSource;
use App\Models\AuditEvent;
use App\Models\Notification;
use App\Models\QrScanDaily;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\ViewDay;
use App\Models\WeeklyRecap;
use App\Services\Insights\EngagementCounters;
use App\Services\Insights\PlatformInsights;
use App\Services\Notifications\EngagementPushLimiter;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/../Support/helpers.php';

// ADM-70 Insights overview (10 §11, m5.7-contract §9): the platform read model, the two counters it needs, the page and its matrix.

const ADM70_ROLES = ['owner', 'admin', 'content_editor'];

beforeEach(function () {
    $this->withHeader('Accept-Language', 'de');
    // A Wednesday noon in Berlin: the ISO week started on Monday 16 November 2026.
    $this->travelTo(CarbonImmutable::parse('2026-11-18 12:00:00', 'Europe/Berlin'));
});

/**
 * Two members with views on several days and sources, sticker scans, recaps of three weeks and the two counters.
 *
 * @return array{members: list<User>, vehicle: Vehicle}
 */
function adm70Data(): array
{
    $first = User::factory()->create(['username' => 'insights.first']);
    $second = User::factory()->create(['username' => 'insights.second']);
    $vehicle = Vehicle::factory()->create(['owner_id' => $second->id]);

    ViewDay::factory()->forProfile($first)->create(['day' => '2026-11-18', 'source' => ViewSource::App, 'views' => 3]);
    ViewDay::factory()->forProfile($first)->create(['day' => '2026-11-18', 'source' => ViewSource::Web, 'views' => 2]);
    ViewDay::factory()->forProfile($first)->create(['day' => '2026-11-17', 'source' => ViewSource::StickerScan, 'views' => 4]);
    ViewDay::factory()->forProfile($first)->create(['day' => '2026-11-17', 'source' => ViewSource::SharedLink, 'views' => 1]);
    ViewDay::factory()->forVehicle($vehicle)->create(['day' => '2026-11-18', 'source' => ViewSource::App, 'views' => 5]);
    // 40 days back: outside 30 days, inside 90.
    ViewDay::factory()->forVehicle($vehicle)->create(['day' => '2026-10-09', 'source' => ViewSource::App, 'views' => 9]);

    QrScanDaily::factory()->create(['day' => '2026-11-18', 'count' => 7]);
    QrScanDaily::factory()->create(['day' => '2026-11-16', 'count' => 3]);

    $week = fn (string $monday, RecapStatus $status, int $count) => WeeklyRecap::factory()->count($count)->create(['week' => $monday, 'status' => $status]);
    $week('2026-11-16', RecapStatus::Sent, 2);
    $week('2026-11-16', RecapStatus::Skipped, 1);
    $week('2026-11-16', RecapStatus::Unreachable, 1);
    $week('2026-11-09', RecapStatus::Sent, 1);
    // Before the 90-day window's first week (17 August).
    $week('2026-08-03', RecapStatus::Sent, 4);

    EngagementCounters::bump(EngagementCounters::PLAN_PROMPT);
    EngagementCounters::bump(EngagementCounters::PLAN_PROMPT);
    EngagementCounters::bump(EngagementCounters::PUSH_DROPPED, 3);
    // Eight days back: outside "last 7 days".
    DB::table('engagement_daily')->insert(['day' => '2026-11-10', 'metric' => EngagementCounters::PLAN_PROMPT, 'count' => 6]);

    return ['members' => [$first, $second], 'vehicle' => $vehicle];
}

it('sums views by day and source, sticker scans, recaps per week and the 7-day counters', function () {
    adm70Data();
    $overview = app(PlatformInsights::class)->overview(30);

    expect($overview['days'])->toHaveCount(30)
        ->and($overview['days'][0]['date'])->toBe('2026-10-20')
        ->and($overview['days'][29])->toBe(['date' => '2026-11-18', 'views_by_source' => ['app' => 8, 'web' => 2, 'sticker_scan' => 0, 'shared_link' => 0], 'sticker_scans' => 7])
        ->and($overview['days'][28])->toBe(['date' => '2026-11-17', 'views_by_source' => ['app' => 0, 'web' => 0, 'sticker_scan' => 4, 'shared_link' => 1], 'sticker_scans' => 0])
        ->and($overview['days'][27]['sticker_scans'])->toBe(3)
        ->and(array_sum(array_map(fn (array $day): int => array_sum($day['views_by_source']), $overview['days'])))->toBe(15)
        ->and($overview['recaps'])->toBe([
            ['week' => '2026-11-16', 'sent' => 2, 'skipped' => 1, 'unreachable' => 1],
            ['week' => '2026-11-09', 'sent' => 1, 'skipped' => 0, 'unreachable' => 0],
        ])
        ->and($overview['plan_prompts'])->toBe(['last_7_days' => 2])
        ->and($overview['engagement_cap'])->toBe(['pushes_dropped_last_7_days' => 3]);
});

it('takes 7, 30 or 90 days and falls back to 30 for anything else', function () {
    adm70Data();
    $insights = app(PlatformInsights::class);

    $ninety = $insights->overview(90);
    expect($ninety['days'])->toHaveCount(90)
        ->and(collect($ninety['days'])->firstWhere('date', '2026-10-09')['views_by_source']['app'])->toBe(9)
        ->and(collect($ninety['recaps'])->pluck('week')->all())->toBe(['2026-11-16', '2026-11-09']);

    expect($insights->overview(7)['days'])->toHaveCount(7)
        ->and($insights->overview(7)['days'][0]['date'])->toBe('2026-11-12')
        ->and($insights->overview(12)['days'])->toHaveCount(30)
        ->and($insights->countingSince())->toBe('2026-10-09');
});

it('answers zeros, not gaps, when nothing was counted', function () {
    $overview = app(PlatformInsights::class)->overview(7);

    expect($overview['days'])->toHaveCount(7)
        ->and(collect($overview['days'])->every(fn (array $day): bool => $day['sticker_scans'] === 0 && array_sum($day['views_by_source']) === 0))->toBeTrue()
        ->and($overview['recaps'])->toBe([])
        ->and($overview['plan_prompts']['last_7_days'])->toBe(0)
        ->and($overview['engagement_cap']['pushes_dropped_last_7_days'])->toBe(0)
        ->and(app(PlatformInsights::class)->countingSince())->toBeNull();
});

it('counts a push the weekly cap drops, without storing who it was for', function () {
    $member = User::factory()->create();
    $limiter = app(EngagementPushLimiter::class);
    $row = fn () => Notification::factory()->create(['notifiable_id' => $member->id, 'type' => NotificationType::BadgeUnlocked]);

    expect($limiter->claim($member, $row()))->toBeTrue()
        ->and($limiter->claim($member, $row()))->toBeTrue()
        ->and($limiter->claim($member, $row()))->toBeTrue()
        ->and($limiter->claim($member, $row()))->toBeFalse()
        ->and($limiter->claim($member, $row()))->toBeFalse();

    $rows = DB::table('engagement_daily')->get();
    expect(EngagementCounters::lastDays(EngagementCounters::PUSH_DROPPED, 7))->toBe(2)
        ->and($rows)->toHaveCount(1)
        // One row per day and metric: no member, notification or type column exists to fill.
        ->and(array_keys((array) $rows->first()))->toBe(['id', 'day', 'metric', 'count'])
        ->and(substr((string) $rows->first()->day, 0, 10))->toBe('2026-11-18')
        ->and((int) $rows->first()->count)->toBe(2);
});

it('lets content.view read the page and refuses the other roles', function () {
    adm70Data();

    assertAdminMatrix('GET', '/admin/insights', ADM70_ROLES, fn (TestResponse $r) => $r->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page->component('Insights/Overview')
            ->where('period', 30)
            ->where('periods', [7, 30, 90])
            ->has('overview.days', 30)
            ->where('overview.days.29.views_by_source.app', 8)
            ->where('overview.plan_prompts.last_7_days', 2)
            ->where('overview.engagement_cap.pushes_dropped_last_7_days', 3)
            ->where('countingSince', '2026-10-09')
            ->has('flags.insights')
            ->where('capPerWeek', 3)));
});

it('switches the period by ?days= and ignores an unknown one', function () {
    seedStaffRoles();
    actingAsStaff(staffWithRole('content_editor'));

    $this->get('/admin/insights?days=7')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->where('period', 7)->has('overview.days', 7));
    $this->get('/admin/insights?days=90')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->where('period', 90)->has('overview.days', 90));
    $this->get('/admin/insights?days=365')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->where('period', 30)->has('overview.days', 30));
    $this->get('/admin/insights?days=abc')->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->where('period', 30));
});

it('hands the page totals only: no member, car or name in the props, and writes nothing', function () {
    ['members' => $members, 'vehicle' => $vehicle] = adm70Data();
    seedStaffRoles();
    actingAsStaff(staffWithRole('content_editor'));
    $audits = AuditEvent::query()->count();

    $html = $this->get('/admin/insights')->assertOk()->getContent();
    preg_match('/<script data-page="[^"]*" type="application\/json">([\s\S]*?)<\/script>/', (string) $html, $match);
    $props = json_encode(json_decode($match[1] ?? '{}', true)['props'] ?? [], JSON_THROW_ON_ERROR);

    foreach ([...$members, $vehicle] as $model) {
        expect(str_contains($props, (string) $model->id))->toBeFalse();
    }

    expect($props)->not->toContain('insights.first')->not->toContain('insights.second')->not->toContain('owner_id')->not->toContain('vehicle_id')
        ->and(AuditEvent::query()->count())->toBe($audits);
});
