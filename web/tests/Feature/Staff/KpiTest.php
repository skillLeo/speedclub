<?php

use App\Models\Appeal;
use App\Models\BuildUpdate;
use App\Models\Decision;
use App\Models\Make;
use App\Models\ModerationCase;
use App\Models\PushToken;
use App\Models\QrCode;
use App\Models\SupportTicket;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Admin\Kpi;
use App\Services\Admin\Kpi\ActivityTracker;
use App\Support\Codes;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Spatie\Health\Checks\Checks\ScheduleCheck;

require_once __DIR__.'/Helpers.php';

/**
 * ADM-06 data (contract §1.6, ADR-216): queues by atom, KPI tiles with previous period and 14-day series, the three charts and the DSA
 * six-month average, all on German days; the anonymous activity counters and the sign-up source.
 */
function m31Kpis(): array
{
    return collect(app(Kpi::class)->kpis())->keyBy('key')->all();
}

/** Noon in Berlin on Monday 9 November 2026. */
function m31Noon(): CarbonImmutable
{
    return CarbonImmutable::parse('2026-11-09 12:00', 'Europe/Berlin');
}

beforeEach(function () {
    $this->travelTo(m31Noon());
});

describe('queues', function () {
    it('counts open cases, appeals and tickets with the oldest one, and only the queues the role may see', function () {
        ModerationCase::factory()->count(2)->create();
        ModerationCase::factory()->decided()->create();
        Appeal::factory()->create();
        SupportTicket::factory()->create();
        SupportTicket::factory()->create(['status' => 'closed', 'closed_at' => now()]);

        $owner = app(Kpi::class)->queues(m31Staff('owner'));

        // DQ-1194: open work is not a warning by itself; the queue turns `warning` once its oldest item is a day old (Kpi::SLA_MINUTES).
        expect($owner['reports'])->toMatchArray(['count' => 2, 'status' => 'ok'])
            ->and($owner['reports']['since'])->toBeString()
            ->and($owner['appeals']['count'])->toBe(1)
            ->and($owner['support_tickets']['count'])->toBe(1)
            ->and($owner['failed_jobs'])->toBe(['count' => 0, 'status' => 'ok', 'since' => null])
            ->and(array_keys(app(Kpi::class)->queues(m31Staff('support'))))->toBe(['support_tickets', 'privacy_due'])
            ->and(array_keys(app(Kpi::class)->queues(m31Staff('moderator'))))->toBe(['reports', 'appeals', 'support_tickets'])
            ->and(app(Kpi::class)->queues(m31Staff('content_editor')))->toBe([]);
    });

    it('marks a queue overdue once its oldest item waits a day', function () {
        ModerationCase::factory()->create(['created_at' => now()->subHours(23)]);
        $owner = m31Staff('owner');

        expect(app(Kpi::class)->queues($owner)['reports']['status'])->toBe('ok');

        ModerationCase::factory()->create(['created_at' => now()->subHours(25)]);

        expect(app(Kpi::class)->queues($owner)['reports'])->toMatchArray(['count' => 2, 'status' => 'warning']);
    });

    it('reads the scheduler heartbeat and the queue backlog', function () {
        $check = ScheduleCheck::new();
        $owner = m31Staff('owner');

        expect(app(Kpi::class)->queues($owner)['scheduler'])->toBe(['count' => null, 'status' => 'danger', 'since' => null]);

        Cache::store($check->getCacheStoreName())->put($check->getCacheKey(), now()->subMinute()->getTimestamp());
        DB::table('jobs')->insert(['queue' => 'default', 'payload' => '{}', 'attempts' => 0, 'available_at' => now()->subMinutes(20)->getTimestamp(), 'created_at' => now()->subMinutes(20)->getTimestamp()]);
        DB::table('failed_jobs')->insert(['uuid' => 'a', 'connection' => 'database', 'queue' => 'default', 'payload' => '{}', 'exception' => 'x', 'failed_at' => now()]);

        $queues = app(Kpi::class)->queues($owner);

        expect($queues['scheduler']['status'])->toBe('ok')
            ->and($queues['queue'])->toMatchArray(['count' => 1, 'status' => 'warning'])
            ->and($queues['failed_jobs'])->toMatchArray(['count' => 1, 'status' => 'danger']);
    });
});

describe('KPI tiles (09 §10.2: six tiles)', function () {
    it('has the six tiles in order, each with a unit, the previous period and 14 days', function () {
        $kpis = m31Kpis();

        expect(array_keys($kpis))->toBe(['members_7d', 'active_builds', 'qr_scans_7d', 'open_reports', 'median_decision', 'push_opt_in'])
            ->and(array_map(fn (array $kpi): string => $kpi['unit'], array_values($kpis)))->toBe(['count', 'count', 'count', 'count', 'minutes', 'percent'])
            ->and(collect($kpis)->every(fn (array $kpi): bool => count($kpi['series']) === 14))->toBeTrue();
    });

    it('counts new members per German day, with the previous week, and leaves samples out', function () {
        // 23:30 UTC on 8 November is 00:30 on 9 November in Berlin: today.
        User::factory()->create(['created_at' => CarbonImmutable::parse('2026-11-08 23:30', 'UTC')]);
        User::factory()->create(['created_at' => CarbonImmutable::parse('2026-11-08 22:30', 'UTC')]);
        User::factory()->count(2)->create(['created_at' => m31Noon()->subDays(10)]);
        User::factory()->create(['created_at' => m31Noon()->subDays(40)]);
        User::factory()->create(['created_at' => m31Noon(), 'is_sample' => true]);

        $kpis = m31Kpis();

        expect($kpis['members_7d'])->toMatchArray(['value' => 2, 'previous' => 2])
            ->and($kpis['members_7d']['series'][13])->toBe(1)
            ->and($kpis['members_7d']['series'][12])->toBe(1)
            ->and($kpis['members_7d']['series'][3])->toBe(2);
    });

    it('counts active builds: published, real, with a visible update in 30 days', function () {
        $active = Vehicle::factory()->published()->create();
        BuildUpdate::factory()->count(2)->create(['vehicle_id' => $active->id, 'created_at' => now()->subDays(2)]);
        BuildUpdate::factory()->create(['vehicle_id' => Vehicle::factory()->published()->create()->id, 'created_at' => now()->subDays(40)]);
        BuildUpdate::factory()->create(['vehicle_id' => Vehicle::factory()->create()->id, 'created_at' => now()]);
        BuildUpdate::factory()->create(['vehicle_id' => Vehicle::factory()->published()->create(['is_sample' => true])->id, 'created_at' => now()]);
        BuildUpdate::factory()->create(['vehicle_id' => Vehicle::factory()->published()->create()->id, 'created_at' => now(), 'hidden' => true]);

        $kpis = m31Kpis();

        expect($kpis['active_builds'])->toMatchArray(['value' => 1, 'previous' => 1])
            ->and($kpis['active_builds']['series'][11])->toBe(1)
            ->and($kpis['active_builds']['series'][13])->toBe(0);
    });

    it('counts QR scans of the week against the week before', function () {
        $qr = QrCode::factory()->create();
        DB::table('qr_scan_daily')->insert([
            ['qr_code_id' => $qr->id, 'day' => '2026-11-09', 'count' => 4],
            ['qr_code_id' => $qr->id, 'day' => '2026-11-01', 'count' => 6],
        ]);

        expect(m31Kpis()['qr_scans_7d'])->toMatchArray(['value' => 4, 'previous' => 6]);
    });

    it('counts open reports now and at the end of each earlier day', function () {
        ModerationCase::factory()->count(2)->create(['created_at' => now()->subDays(3)]);
        ModerationCase::factory()->decided()->create(['created_at' => now()->subDays(10), 'decided_at' => now()->subDays(1)]);

        $kpis = m31Kpis();

        expect($kpis['open_reports'])->toMatchArray(['value' => 2, 'previous' => 1])
            ->and($kpis['open_reports']['series'][13])->toBe(2)
            ->and($kpis['open_reports']['series'][12])->toBe(2)
            ->and($kpis['open_reports']['series'][0])->toBe(0);
    });

    it('takes the median minutes from the first report to a staff decision, null without decisions', function () {
        expect(m31Kpis()['median_decision'])->toMatchArray(['value' => null, 'previous' => null]);

        $staff = m31Staff('moderator');
        foreach ([30, 90, 600] as $minutes) {
            $case = ModerationCase::factory()->decided()->create(['created_at' => now()->subMinutes($minutes), 'decided_at' => now()]);
            Decision::factory()->create(['case_id' => $case->id, 'decided_by' => $staff->id, 'decided_at' => now()]);
        }
        $old = ModerationCase::factory()->decided()->create(['created_at' => now()->subDays(9)->subMinutes(20), 'decided_at' => now()->subDays(9)]);
        Decision::factory()->create(['case_id' => $old->id, 'decided_by' => $staff->id, 'decided_at' => now()->subDays(9)]);

        $kpis = m31Kpis();

        expect($kpis['median_decision'])->toMatchArray(['value' => 90, 'previous' => 20])
            ->and($kpis['median_decision']['series'][13])->toBe(90)
            ->and($kpis['median_decision']['series'][12])->toBeNull();
    });

    it('gives the Push-Opt-in of active members, with history only from snapshots', function () {
        expect(m31Kpis()['push_opt_in']['value'])->toBeNull();

        $withPush = User::factory()->count(2)->create(['last_seen_at' => now()]);
        User::factory()->create(['last_seen_at' => now()]);
        User::factory()->create(['last_seen_at' => now()->subDays(40)]);
        PushToken::factory()->create(['user_id' => $withPush[0]->id]);
        DB::table('push_subscriptions')->insert([
            'id' => strtolower((string) Str::ulid()), 'user_id' => $withPush[1]->id, 'endpoint_hash' => str_repeat('a', 64), 'endpoint' => 'x',
            'public_key' => 'x', 'auth_token' => 'x', 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('activity_days')->insert(['day' => '2026-11-02', 'members' => 0, 'push_members' => 1, 'push_base' => 4]);

        $kpis = m31Kpis();

        expect($kpis['push_opt_in'])->toMatchArray(['value' => 0.667, 'previous' => 0.25])
            ->and($kpis['push_opt_in']['series'][13])->toBe(0.667)
            ->and($kpis['push_opt_in']['series'][12])->toBeNull();
    });

    it('stores the Push-Opt-in on the day before with the snapshot command', function () {
        PushToken::factory()->create(['user_id' => User::factory()->create(['last_seen_at' => now()])->id]);

        $this->artisan('speedclub:kpi-snapshot')->assertSuccessful();

        expect(DB::table('activity_days')->where('day', '2026-11-08')->first(['push_members', 'push_base']))->toEqual((object) ['push_members' => 1, 'push_base' => 1]);
    });

    it('caches the tiles for the dashboard', function () {
        expect(app(Kpi::class)->tiles()[0]['value'])->toBe(0);
        User::factory()->create(['created_at' => now()]);

        expect(app(Kpi::class)->tiles()[0]['value'])->toBe(0)
            ->and(app(Kpi::class)->kpis()[0]['value'])->toBe(1);
    });

    it('never shows fewer active members for a longer window: DAU ≤ WAU ≤ MAU (DQ-571)', function () {
        foreach ([0, 0, 1, 3, 6, 7, 12, 29, 31] as $daysAgo) {
            User::factory()->create(['last_seen_at' => now()->subDays($daysAgo)]);
        }

        $active = app(Kpi::class)->activeMembers();

        expect($active)->toBe(['dau' => 2, 'wau' => 5, 'mau' => 8]);
    });
});

describe('charts and the DSA average', function () {
    it('gives 30 days of registrations and of the QR funnel, and the top makes', function () {
        $bmw = Make::factory()->create(['name' => 'BMW']);
        $vw = Make::factory()->create(['name' => 'Volkswagen']);
        Vehicle::factory()->published()->count(3)->create(['make_id' => $bmw->id]);
        Vehicle::factory()->published()->create(['make_id' => $vw->id]);
        Vehicle::factory()->create(['make_id' => $vw->id]);
        User::factory()->create(['signup_ref' => 'qr', 'created_at' => now()->subDay()]);
        // DQ-1196: today is still running and stays out of the charts.
        User::factory()->create(['signup_ref' => 'qr']);

        $charts = app(Kpi::class)->charts();

        expect($charts['registrations'])->toHaveCount(30)
            ->and($charts['registrations'][0]['date'])->toBe('2026-10-10')
            ->and($charts['registrations'][29]['date'])->toBe('2026-11-08')
            ->and($charts['qr_funnel'][29])->toMatchArray(['date' => '2026-11-08', 'registrations' => 1])
            ->and(array_slice($charts['top_makes'], 0, 2))->toBe([['label' => 'BMW', 'value' => 3], ['label' => 'Volkswagen', 'value' => 1]]);
    });

    it('ends the day windows on a frozen moment (QaClock) and caches that day apart', function () {
        User::factory()->create(['created_at' => CarbonImmutable::parse('2026-11-01 10:00', 'Europe/Berlin')]);

        $frozen = app(Kpi::class)->at(CarbonImmutable::parse('2026-11-02 12:00', 'Europe/Berlin'));
        $charts = $frozen->charts();
        $tiles = collect($frozen->tiles())->keyBy('key');

        expect($charts['registrations'][29])->toBe(['date' => '2026-11-01', 'value' => 1])
            ->and($tiles['members_7d']['value'])->toBe(1)
            ->and(Cache::has(Kpi::CACHE_KEY.':2026-11-02'))->toBeTrue()
            ->and(Cache::has(Kpi::CACHE_KEY))->toBeFalse()
            ->and(app(Kpi::class)->charts()['registrations'][29]['date'])->toBe('2026-11-08');
    });

    it('averages the last six full months that have a count', function () {
        DB::table('activity_months')->insert([
            ['month' => '2026-10-01', 'members' => 120],
            ['month' => '2026-09-01', 'members' => 80],
            ['month' => '2026-11-01', 'members' => 999],
        ]);

        $dsa = app(Kpi::class)->dsa();

        expect($dsa['average'])->toBe(100)
            ->and(array_column($dsa['months'], 'month'))->toBe(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    });

    it('has no average before the first month was counted', function () {
        expect(app(Kpi::class)->dsa()['average'])->toBeNull();
    });
});

describe('ADR-216 activity counters', function () {
    it('counts a member once a German day and once a month, and moves last_seen_at at most hourly', function () {
        $member = User::factory()->create(['last_seen_at' => m31Noon()->subDays(40)]);
        $tracker = app(ActivityTracker::class);

        $tracker->seen($member);
        $this->travel(10)->minutes();
        $tracker->seen($member->fresh() ?? $member);

        expect(DB::table('activity_days')->where('day', '2026-11-09')->value('members'))->toBe(1)
            ->and(DB::table('activity_months')->where('month', '2026-11-01')->value('members'))->toBe(1)
            ->and($member->fresh()?->last_seen_at?->equalTo(m31Noon()))->toBeTrue();

        $this->travel(2)->hours();
        $tracker->seen($member->fresh() ?? $member);
        expect(DB::table('activity_days')->where('day', '2026-11-09')->value('members'))->toBe(1)
            ->and($member->fresh()?->last_seen_at?->greaterThan(m31Noon()->addHour()))->toBeTrue();
    });

    it('counts a stale copy of the member only once', function () {
        $member = User::factory()->create(['last_seen_at' => m31Noon()->subDays(2)]);
        $copy = User::query()->findOrFail($member->id);

        app(ActivityTracker::class)->seen($member);
        app(ActivityTracker::class)->seen($copy);

        expect((int) DB::table('activity_days')->sum('members'))->toBe(1);
    });

    it('moves on authenticated use through a token, not only at sign-in', function () {
        $member = User::factory()->create(['last_seen_at' => m31Noon()->subDays(3)]);
        $token = $member->createToken('Pixel 8', ['member'])->plainTextToken;

        $this->withToken($token)->getJson('/api/v1/auth/me')->assertOk();

        expect(DB::table('activity_days')->where('day', '2026-11-09')->value('members'))->toBe(1);
    });

    it('stores the rolling seven-day count of the day before', function () {
        User::factory()->count(2)->create(['last_seen_at' => m31Noon()->subDays(3)]);
        User::factory()->create(['last_seen_at' => m31Noon()->subDays(12)]);

        $this->artisan('speedclub:kpi-snapshot')->assertSuccessful();

        expect(DB::table('activity_days')->where('day', '2026-11-08')->value('weekly'))->toBe(2);
    });
});

describe('ADR-216 sign-up source', function () {
    it('stores the ref sent with the registration', function () {
        $this->postJson('/api/v1/auth/register', [
            'email' => 'neu@speedclub.test',
            'password' => 'ein-sicheres-passwort-77',
            'accepted_age_16' => true,
            'accepted_terms' => true,
            'accepted_privacy' => true,
            'ref' => 'qr',
        ])->assertStatus(202);

        expect(User::query()->where('email', 'neu@speedclub.test')->value('signup_ref'))->toBe('qr');
    });

    it('refuses an unknown ref', function () {
        $this->postJson('/api/v1/auth/register', ['email' => 'neu@speedclub.test', 'password' => 'ein-sicheres-passwort-77', 'accepted_age_16' => true, 'accepted_terms' => true, 'accepted_privacy' => true, 'ref' => 'newsletter'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('ref');
    });

    it('stores none without a ref (control)', function () {
        $this->postJson('/api/v1/auth/register', ['email' => 'neu@speedclub.test', 'password' => 'ein-sicheres-passwort-77', 'accepted_age_16' => true, 'accepted_terms' => true, 'accepted_privacy' => true])->assertStatus(202);

        expect(User::query()->where('email', 'neu@speedclub.test')->value('signup_ref'))->toBeNull();
    });
});

it('is fast on 20,000 members and 2,000 vehicles', function () {
    $password = Hash::make('x');
    $make = Make::factory()->create();
    $users = [];

    foreach (range(1, 20000) as $i) {
        $users[] = [
            'id' => strtolower((string) Str::ulid()),
            'email' => "perf$i@speedclub.test",
            'password' => $password,
            'username' => "perf$i",
            'status' => 'active',
            'created_at' => m31Noon()->subMinutes($i * 7)->utc()->format('Y-m-d H:i:s'),
            'updated_at' => now()->utc()->format('Y-m-d H:i:s'),
            'last_seen_at' => m31Noon()->subMinutes($i * 3)->utc()->format('Y-m-d H:i:s'),
            'signup_ref' => $i % 5 === 0 ? 'qr' : null,
        ];
    }

    foreach (array_chunk($users, 1000) as $chunk) {
        DB::table('users')->insert($chunk);
    }

    $owners = array_column(array_slice($users, 0, 2000), 'id');
    $vehicles = array_map(fn (string $owner, int $i): array => [
        'id' => strtolower((string) Str::ulid()),
        'owner_id' => $owner,
        'public_id' => Codes::generate(),
        'slug' => "perf-$i",
        'status' => 'published',
        'visibility' => 'public',
        'make_id' => $make->id,
        'published_at' => m31Noon()->subHours($i)->utc()->format('Y-m-d H:i:s'),
        'created_at' => now()->utc()->format('Y-m-d H:i:s'),
        'updated_at' => now()->utc()->format('Y-m-d H:i:s'),
    ], $owners, array_keys($owners));

    foreach (array_chunk($vehicles, 500) as $chunk) {
        DB::table('vehicles')->insert($chunk);
    }

    $kpi = app(Kpi::class);
    $owner = m31Staff('owner');
    $start = hrtime(true);
    $kpi->queues($owner);
    $kpi->kpis();
    $kpi->charts();
    $kpi->dsa();
    $ms = (hrtime(true) - $start) / 1e6;

    expect($ms)->toBeLessThan(1500.0);
})->group('perf');
