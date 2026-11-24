<?php

use App\Enums\UserStatus;
use App\Models\CarOfTheDay;
use App\Models\CarOfTheDayCandidate;
use App\Models\CarOfTheDayVote;
use App\Models\FeatureFlag;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/../Support/helpers.php';

/**
 * ADM-64 "Abstimmungen" (R4-2.1, contract-cotd-voting §4, V5/V6/V8): staff with content.view see every vote round of the page's range,
 * newest first, with the Picker's suggestions in position order, all votes and the counted ones (removed or blocked accounts drop out),
 * which candidate became the Car of the Day, and how the day was decided: open, counting, by vote, by the Picker, or by the team (a staff
 * choice or skip wins over the votes). The counts are staff data only.
 */
beforeEach(fn () => $this->travelTo(CarbonImmutable::parse('2026-07-15 19:00', 'Europe/Berlin')));

function adm64vFlag(bool $on): void
{
    FeatureFlag::query()->updateOrCreate(['key' => 'cotd_voting'], ['enabled' => $on, 'description' => 'cotd_voting']);
    request()->attributes->remove('speedclub.flags');
}

/**
 * @return list<CarOfTheDayCandidate>
 */
function adm64vRound(string $day, int $count = 3): array
{
    return array_map(fn (int $position) => CarOfTheDayCandidate::factory()->create(['day' => $day, 'position' => $position]), range(1, $count));
}

function adm64vVotes(string $day, string $vehicleId, int $count, array $voter = []): void
{
    for ($i = 0; $i < $count; $i++) {
        CarOfTheDayVote::factory()->create(['day' => $day, 'vehicle_id' => $vehicleId, 'user_id' => User::factory()->create($voter)->id]);
    }
}

/**
 * @return array<string, mixed>
 */
function adm64vProps(string $role = 'content_editor'): array
{
    seedStaffRoles();
    actingAsStaff(staffWithRole($role));

    return test()->get('/admin/content/car-of-the-day')->assertOk()->inertiaProps('votes');
}

it('shows each round with its candidates in the Picker\'s order and all and counted votes', function () {
    adm64vFlag(true);
    [$a, $b, $c] = adm64vRound('2026-07-16');
    adm64vVotes('2026-07-16', $b->vehicle_id, 3);
    adm64vVotes('2026-07-16', $b->vehicle_id, 2, ['status' => UserStatus::Suspended]);
    adm64vVotes('2026-07-16', $a->vehicle_id, 1);

    $votes = adm64vProps();

    expect($votes['enabled'])->toBeTrue()
        ->and($votes['closes_at'])->toBe('17:00')
        ->and($votes['rounds'])->toHaveCount(1)
        ->and($votes['rounds'][0])->toMatchArray(['day' => '2026-07-16', 'status' => 'open', 'total' => 6])
        ->and($votes['rounds'][0]['closes_at'])->toBe(CarbonImmutable::parse('2026-07-16 17:00', 'Europe/Berlin')->toIso8601String())
        ->and(collect($votes['rounds'][0]['candidates'])->map(fn (array $x) => [$x['position'], $x['vehicle']['id'], $x['votes'], $x['counted'], $x['winner']])->all())->toBe([
            [1, $a->vehicle_id, 1, 1, false],
            [2, $b->vehicle_id, 5, 3, false],
            [3, $c->vehicle_id, 0, 0, false],
        ]);
});

it('says how each day was decided, and a team choice or skip wins over the votes', function () {
    adm64vFlag(true);
    // 15th: picked by the votes. 14th: the team chose a car the votes did not favour. 13th: skipped by the team. 12th: no counted vote.
    [$v15] = adm64vRound('2026-07-15');
    adm64vVotes('2026-07-15', $v15->vehicle_id, 2);
    CarOfTheDay::factory()->create(['day' => '2026-07-15', 'vehicle_id' => $v15->vehicle_id, 'source' => 'auto', 'by_vote' => true]);

    [$top14, $staff14] = adm64vRound('2026-07-14', 2);
    adm64vVotes('2026-07-14', $top14->vehicle_id, 4);
    CarOfTheDay::factory()->create(['day' => '2026-07-14', 'vehicle_id' => $staff14->vehicle_id, 'source' => 'staff']);

    adm64vRound('2026-07-13', 2);
    CarOfTheDay::factory()->create(['day' => '2026-07-13', 'vehicle_id' => null, 'skipped' => true, 'skipped_reason' => 'Wartung', 'source' => 'staff', 'published_at' => null]);

    [$p12] = adm64vRound('2026-07-12', 2);
    CarOfTheDay::factory()->create(['day' => '2026-07-12', 'vehicle_id' => $p12->vehicle_id, 'source' => 'auto', 'by_vote' => false]);

    // Tomorrow's round, frozen at 18:00: still open.
    adm64vRound('2026-07-16', 2);

    $rounds = collect(adm64vProps()['rounds'])->keyBy('day');

    expect($rounds->keys()->all())->toBe(['2026-07-16', '2026-07-15', '2026-07-14', '2026-07-13', '2026-07-12'])
        ->and($rounds['2026-07-16']['status'])->toBe('open')
        ->and($rounds['2026-07-15']['status'])->toBe('by_vote')
        ->and($rounds['2026-07-15']['candidates'][0]['winner'])->toBeTrue()
        ->and($rounds['2026-07-14']['status'])->toBe('staff')
        ->and(collect($rounds['2026-07-14']['candidates'])->pluck('winner')->all())->toBe([false, true])
        ->and($rounds['2026-07-13']['status'])->toBe('staff')
        ->and(collect($rounds['2026-07-13']['candidates'])->pluck('winner')->all())->toBe([false, false])
        ->and($rounds['2026-07-12']['status'])->toBe('picker');
});

it('says why the round that opened last has no vote (R4DQ-34)', function () {
    adm64vFlag(true);

    // 19:00 on the 15th: the round for the 16th opened at 18:00. Nobody qualifies, so the admin read freezes nothing.
    $votes = adm64vProps();
    expect($votes['current'])->toBe(['day' => '2026-07-16', 'unavailable' => 'too_few_candidates'])
        ->and($votes['rounds'])->toBe([]);

    // A team choice for the day wins over any vote.
    CarOfTheDay::factory()->create(['day' => '2026-07-16', 'source' => 'staff']);
    expect(adm64vProps()['current'])->toBe(['day' => '2026-07-16', 'unavailable' => 'staff_decided']);
});

it('names no reason while the round that opened last has its candidates', function () {
    adm64vFlag(true);
    adm64vRound('2026-07-16', 2);

    expect(adm64vProps()['current'])->toBe(['day' => '2026-07-16', 'unavailable' => null]);
});

it('marks a closed round without a row as counting', function () {
    adm64vFlag(true);
    $this->travelTo(CarbonImmutable::parse('2026-07-16 17:30', 'Europe/Berlin'));
    adm64vRound('2026-07-16', 2);

    expect(adm64vProps()['rounds'][0]['status'])->toBe('counting');
});

it('marks the day row picked by vote in the day list', function () {
    adm64vFlag(true);
    [$v] = adm64vRound('2026-07-15');
    CarOfTheDay::factory()->create(['day' => '2026-07-15', 'vehicle_id' => $v->vehicle_id, 'source' => 'auto', 'by_vote' => true]);
    seedStaffRoles();
    actingAsStaff(staffWithRole('admin'));

    $this->get('/admin/content/car-of-the-day')->assertInertia(fn (AssertableInertia $page) => $page->where('upcoming.0.day', '2026-07-15')->where('upcoming.0.by_vote', true)->where('upcoming.1.by_vote', false)->etc());
});

it('says when voting is off and still shows earlier rounds', function () {
    adm64vFlag(false);

    expect(adm64vProps())->toMatchArray(['enabled' => false, 'rounds' => []]);

    adm64vRound('2026-07-10', 2);
    expect(adm64vProps()['rounds'])->toHaveCount(1);
});

it('keeps the votes to content.view staff', function () {
    adm64vFlag(true);
    adm64vRound('2026-07-16');

    assertAdminMatrix('GET', '/admin/content/car-of-the-day', ['owner', 'admin', 'content_editor'], fn (TestResponse $r) => $r->assertOk()->assertInertia(fn (AssertableInertia $page) => $page->has('votes.rounds', 1)));
});
