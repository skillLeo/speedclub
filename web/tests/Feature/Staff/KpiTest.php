<?php

use App\Enums\SignupRef;
use App\Models\Appeal;
use App\Models\Make;
use App\Models\Message;
use App\Models\ModerationCase;
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

        expect($owner['reports'])->toMatchArray(['count' => 2, 'status' => 'warning'])
            ->and($owner['reports']['since'])->toBeString()
            ->and($owner['appeals']['count'])->toBe(1)
            ->and($owner['support_tickets']['count'])->toBe(1)
            ->and($owner['failed_jobs'])->toBe(['count' => 0, 'status' => 'ok', 'since' => null])
            ->and(array_keys(app(Kpi::class)->queues(m31Staff('support'))))->toBe(['support_tickets', 'privacy_due'])
            ->and(array_keys(app(Kpi::class)->queues(m31Staff('moderator'))))->toBe(['reports', 'appeals', 'support_tickets'])
            ->and(app(Kpi::class)->queues(m31Staff('content_editor')))->toBe([]);
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

describe('KPI tiles', function () {
    it('counts new members per German day, with the previous period', function () {
        // 23:30 UTC on 8 November is 00:30 on 9 November in Berlin: today.
        User::factory()->create(['created_at' => CarbonImmutable::parse('2026-11-08 23:30', 'UTC')]);
        User::factory()->create(['created_at' => CarbonImmutable::parse('2026-11-08 22:30', 'UTC')]);
        User::factory()->count(2)->create(['created_at' => m31Noon()->subDays(10)]);
        User::factory()->create(['created_at' => m31Noon()->subDays(40)]);

        $kpis = m31Kpis();

        expect($kpis['members_today'])->toMatchArray(['value' => 1, 'previous' => 1])
            ->and($kpis['members_7d'])->toMatchArray(['value' => 2, 'previous' => 2])
            ->and($kpis['members_30d'])->toMatchArray(['value' => 4, 'previous' => 1])
            ->and($kpis['members_today']['series'])->toHaveCount(14)
            ->and($kpis['members_today']['series'][13])->toBe(1)
            ->and($kpis['members_today']['series'][12])->toBe(1)
            ->and($kpis['members_today']['series'][3])->toBe(2);
    });

    it('takes today\'s DAU and the WAU from last_seen_at (one source, DQ-571) and the history from the counters', function () {
        DB::table('activity_days')->insert([
            ['day' => '2026-11-09', 'members' => 7, 'weekly' => null],
            ['day' => '2026-11-08', 'members' => 5, 'weekly' => 9],
            ['day' => '2026-11-02', 'members' => 3, 'weekly' => 4],
        ]);
        User::factory()->create(['last_seen_at' => now()]);
        User::factory()->count(3)->create(['last_seen_at' => now()->subDays(2)]);
        User::factory()->create(['last_seen_at' => now()->subDays(9)]);
        User::factory()->create(['last_seen_at' => now(), 'deleted_at' => now()]);

        $kpis = m31Kpis();

        // The day counter said 7 (it also counts accounts deleted since); the tile shows who is here and was active today.
        expect($kpis['dau'])->toMatchArray(['value' => 1, 'previous' => 5])
            ->and($kpis['dau']['series'][13])->toBe(1)
            ->and($kpis['wau']['value'])->toBe(4)
            ->and($kpis['wau']['previous'])->toBe(4)
            ->and($kpis['wau']['series'][12])->toBe(9)
            ->and($kpis['wau']['series'][13])->toBe(4);
    });

    it('never shows fewer active members for a longer window: DAU ≤ WAU ≤ MAU (DQ-571)', function () {
        DB::table('activity_days')->insert(['day' => now(config()->string('speedclub.display_timezone'))->toDateString(), 'members' => 42, 'weekly' => null]);
        foreach ([0, 0, 1, 3, 6, 7, 12, 29, 31] as $daysAgo) {
            User::factory()->create(['last_seen_at' => now()->subDays($daysAgo)]);
        }

        $active = app(Kpi::class)->activeMembers();
        $kpis = m31Kpis();

        expect($active['dau'])->toBeLessThanOrEqual($active['wau'])
            ->and($active['wau'])->toBeLessThanOrEqual($active['mau'])
            ->and($kpis['dau']['value'])->toBe($active['dau'])
            ->and($kpis['wau']['value'])->toBe($active['wau'])
            ->and($kpis['dau']['value'])->toBeLessThanOrEqual($kpis['wau']['value']);
    });

    it('counts published vehicles, QR scans, QR sign-ups and messages', function () {
        Vehicle::factory()->published()->count(2)->create();
        Vehicle::factory()->create();
        $qr = QrCode::factory()->create();
        DB::table('qr_scan_daily')->insert([
            ['qr_code_id' => $qr->id, 'day' => '2026-11-09', 'count' => 4],
            ['qr_code_id' => $qr->id, 'day' => '2026-11-01', 'count' => 6],
        ]);
        User::factory()->create(['signup_ref' => SignupRef::Qr->value]);
        User::factory()->create(['signup_ref' => SignupRef::PublicVehicle->value]);
        Message::factory()->count(3)->create();

        $kpis = m31Kpis();

        expect($kpis['vehicles_published']['value'])->toBe(3)
            ->and($kpis['qr_scans_7d'])->toMatchArray(['value' => 4, 'previous' => 6])
            ->and($kpis['qr_registrations_7d']['value'])->toBe(1)
            ->and($kpis['messages_7d']['value'])->toBe(3)
            ->and(array_keys(m31Kpis()))->toBe(['members_today', 'members_7d', 'members_30d', 'dau', 'wau', 'vehicles_published', 'qr_scans_7d', 'qr_registrations_7d', 'messages_7d']);
    });
});

describe('charts and the DSA average', function () {
    it('gives 30 days of registrations and of the QR funnel, and the top makes', function () {
        $bmw = Make::factory()->create(['name' => 'BMW']);
        $vw = Make::factory()->create(['name' => 'Volkswagen']);
        Vehicle::factory()->published()->count(3)->create(['make_id' => $bmw->id]);
        Vehicle::factory()->published()->create(['make_id' => $vw->id]);
        Vehicle::factory()->create(['make_id' => $vw->id]);
        User::factory()->create(['signup_ref' => 'qr']);

        $charts = app(Kpi::class)->charts();

        expect($charts['registrations'])->toHaveCount(30)
            ->and($charts['registrations'][29]['date'])->toBe('2026-11-09')
            ->and($charts['qr_funnel'][29])->toMatchArray(['date' => '2026-11-09', 'registrations' => 1])
            ->and(array_slice($charts['top_makes'], 0, 2))->toBe([['label' => 'BMW', 'value' => 3], ['label' => 'Volkswagen', 'value' => 1]]);
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
