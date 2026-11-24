<?php

use App\Actions\Admin\CarOfTheDay\OverrideCarOfTheDay;
use App\Actions\Admin\CarOfTheDay\SkipCarOfTheDay;
use App\Enums\Bundesland;
use App\Enums\CarOfTheDayRoundUnavailable;
use App\Enums\RestrictionType;
use App\Http\RateLimits;
use App\Models\AuditEvent;
use App\Models\CarOfTheDay;
use App\Models\CarOfTheDayCandidate;
use App\Models\CarOfTheDayVote;
use App\Models\FeatureFlag;
use App\Models\Media;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\CarOfTheDay\CarOfTheDayPicker;
use App\Services\CarOfTheDay\CarOfTheDayRunner;
use App\Services\CarOfTheDay\CarOfTheDayVotes;
use App\Services\CarOfTheDay\CarOfTheDayVoting;
use App\Services\DataExport\ExportContents;
use App\Services\Search\VehicleSearchProjector;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Testing\TestResponse;
use Laravel\Sanctum\Sanctum;

require_once dirname(__DIR__).'/Gift/GiftTestHelpers.php';
require_once dirname(__DIR__).'/Admin/Support/helpers.php';

/**
 * R4-2.1 Car of the Day voting (docs/reports/round-4/contract-cotd-voting.md): the flag, the round's times (opens 18:00 the day
 * before, closes 17:00), the frozen candidates (the Picker's top 3, never a sample), who may vote (authorisation matrix: guest, member,
 * own car, new account, unverified, restricted, suspended, sample, staff), one changeable vote, no counts in any member response, the
 * 17:55 pick by votes (tie → position, dropped voters, staff choice and skip win, flag off ignores votes), idempotency, the rate limit,
 * the staff tally and the data export.
 */
function vtAt(string $time, string $day = '2026-07-14'): CarbonImmutable
{
    return CarbonImmutable::parse("$day $time", 'Europe/Berlin');
}

function vtFlag(bool $on = true): void
{
    FeatureFlag::query()->updateOrCreate(['key' => 'cotd_voting'], ['enabled' => $on, 'description' => 'cotd_voting']);
    request()->attributes->remove('speedclub.flags');
}

/** A voter old enough, verified, active. */
function vtVoter(array $attributes = []): User
{
    return User::factory()->create(['created_at' => now()->subDays(4), ...$attributes]);
}

function vtCast(string $vehicleId, string $day = '2026-07-15', array $headers = []): TestResponse
{
    return test()->postJson('/api/v1/car-of-the-day/vote', ['day' => $day, 'vehicle_id' => $vehicleId], $headers);
}

/** Freezes the round of 15 July, casts $votes (vehicle per voter) and runs the job at 17:55 on 15 July. */
function vtDecide(array $votes): ?CarOfTheDay
{
    test()->getJson('/api/v1/car-of-the-day/vote');

    foreach ($votes as $vehicleId) {
        Sanctum::actingAs(vtVoter());
        vtCast($vehicleId)->assertOk();
    }

    test()->travelTo(vtAt('17:55', '2026-07-15'));
    app(CarOfTheDayRunner::class)->run();

    return CarOfTheDay::query()->where('day', '2026-07-15')->first();
}

/** The frozen candidates of 15 July in position order. */
function vtOrder(): array
{
    return CarOfTheDayCandidate::query()->where('day', '2026-07-15')->orderBy('position')->pluck('vehicle_id')->all();
}

beforeEach(function () {
    // 14 July, 19:00 Berlin: the round for 15 July is open (it closes on 15 July at 17:00).
    $this->travelTo(vtAt('19:00'));
    $this->withHeader('Accept-Language', 'de');
    vtFlag();
    FeatureFlag::query()->updateOrCreate(['key' => 'editorial_samples'], ['enabled' => true, 'description' => 'editorial_samples']);
    $this->a = giftCar(giftMember(['bundesland' => Bundesland::NW, 'created_at' => now()->subDays(30)]), 900);
    $this->b = giftCar(giftMember(['bundesland' => Bundesland::BY, 'created_at' => now()->subDays(30)]), 800);
    $this->c = giftCar(giftMember(['bundesland' => Bundesland::BE, 'created_at' => now()->subDays(30)]), 700);
    $this->sample = giftCar(giftMember(['bundesland' => Bundesland::HH, 'is_sample' => true]), 990, attributes: ['is_sample' => true]);
});

describe('the flag and the guest', function () {
    it('answers 401 to a guest before the flag, and 404 feature_disabled while the flag is off', function () {
        vtFlag(false);

        $this->getJson('/api/v1/car-of-the-day/vote')->assertUnauthorized()->assertJsonPath('code', 'unauthenticated');
        vtCast($this->a->id)->assertUnauthorized();

        Sanctum::actingAs(vtVoter());
        $this->getJson('/api/v1/car-of-the-day/vote')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
        vtCast($this->a->id)->assertNotFound()->assertJsonPath('code', 'feature_disabled');
        expect(CarOfTheDayVote::query()->count())->toBe(0);
    });

    it('answers 401 to a staff session', function () {
        $this->withCredentials()->withCookie('sc_staff_session', databaseSessionFor(Staff::factory()->create(), 'staff'))->withHeader('Origin', 'http://localhost:8080');

        $this->getJson('/api/v1/car-of-the-day/vote')->assertUnauthorized();
        vtCast($this->a->id)->assertUnauthorized();
    });
});

describe('the round', function () {
    it('freezes the Picker\'s top 3 real cars when it opens, in its order, never a sample, and shows no count', function () {
        Sanctum::actingAs(vtVoter());

        $response = $this->getJson('/api/v1/car-of-the-day/vote')->assertOk()
            ->assertJsonPath('data.round.day', '2026-07-15')
            ->assertJsonPath('data.round.status', 'open')
            ->assertJsonPath('data.round.unavailable_reason', null)
            ->assertJsonPath('data.round.opens_at', vtAt('18:00')->toIso8601String())
            ->assertJsonPath('data.round.closes_at', vtAt('17:00', '2026-07-15')->toIso8601String())
            ->assertJsonPath('data.round.can_vote', true)
            ->assertJsonPath('data.round.cannot_vote_reason', null)
            ->assertJsonPath('data.round.my_vote', null)
            ->assertJsonPath('data.last_result', null)
            ->assertJsonCount(3, 'data.round.candidates');

        $ids = collect($response->json('data.round.candidates'))->pluck('vehicle.id')->all();
        expect($ids)->toHaveCount(3)->not->toContain($this->sample->id)
            ->and(collect($response->json('data.round.candidates'))->pluck('position')->all())->toBe([1, 2, 3])
            ->and(CarOfTheDayCandidate::query()->where('day', '2026-07-15')->orderBy('position')->pluck('vehicle_id')->all())->toBe($ids)
            ->and(json_encode($response->json(), JSON_THROW_ON_ERROR))->not->toContain('"votes"')->not->toContain('"count"')->not->toContain('"counted"');

        // Frozen: a better car published later does not join the round.
        giftCar(giftMember(['bundesland' => Bundesland::SH]), 999);
        $this->getJson('/api/v1/car-of-the-day/vote')->assertOk()->assertJsonPath('data.round.candidates.0.vehicle.id', $ids[0]);
        expect(CarOfTheDayCandidate::query()->count())->toBe(3);
    });

    it('opens the next day\'s round at 18:00 and is closed from 17:00 until then', function () {
        Sanctum::actingAs(vtVoter(['created_at' => vtAt('10:00')->subDays(10)]));
        $this->getJson('/api/v1/car-of-the-day/vote')->assertOk();

        $this->travelTo(vtAt('17:00', '2026-07-15'));
        $this->getJson('/api/v1/car-of-the-day/vote')->assertOk()->assertJsonPath('data.round.day', '2026-07-15')
            ->assertJsonPath('data.round.status', 'closed')->assertJsonPath('data.round.can_vote', false)
            ->assertJsonPath('data.round.cannot_vote_reason', 'closed')->assertJsonPath('data.round.candidates.0.votable', false);
        vtCast($this->a->id)->assertUnprocessable()->assertJsonPath('code', 'validation_failed')
            ->assertJsonPath('errors.day.0', 'Die Abstimmung für diesen Tag ist geschlossen.');

        $this->travelTo(vtAt('18:00', '2026-07-15'));
        $this->getJson('/api/v1/car-of-the-day/vote')->assertOk()->assertJsonPath('data.round.day', '2026-07-16')->assertJsonPath('data.round.status', 'open');
        vtCast($this->a->id)->assertUnprocessable()->assertJsonPath('errors.day.0', 'Die Abstimmung für diesen Tag ist geschlossen.');
    });

    it('refuses a round that has not opened yet', function () {
        Sanctum::actingAs(vtVoter());

        vtCast($this->a->id, '2026-07-16')->assertUnprocessable()->assertJsonPath('errors.day.0', 'Die Abstimmung für diesen Tag hat noch nicht begonnen.');
    });

    it('has no round with fewer than two candidates, and refuses votes for it', function () {
        Vehicle::query()->whereKeyNot($this->a->id)->get()->each(function (Vehicle $vehicle): void {
            $vehicle->forceFill(['visibility' => 'private'])->save();
            app(VehicleSearchProjector::class)->rebuild($vehicle->id);
        });
        Sanctum::actingAs(vtVoter());

        $this->getJson('/api/v1/car-of-the-day/vote')->assertOk()->assertJsonPath('data.round.status', 'unavailable')
            ->assertJsonPath('data.round.unavailable_reason', 'too_few_candidates')->assertJsonCount(0, 'data.round.candidates');
        vtCast($this->a->id)->assertUnprocessable()->assertJsonPath('errors.day.0', 'Für diesen Tag gibt es keine Abstimmung.');
    });

    it('marks the reader\'s own car as not votable and leaves out a candidate behind a block', function () {
        $owner = User::query()->findOrFail($this->a->owner_id);
        giftBlock(User::query()->findOrFail($this->b->owner_id), $owner);
        Sanctum::actingAs($owner);

        $candidates = collect($this->getJson('/api/v1/car-of-the-day/vote')->assertOk()->json('data.round.candidates'));

        expect($candidates->pluck('vehicle.id')->all())->toContain($this->a->id)->not->toContain($this->b->id)
            ->and($candidates->firstWhere('vehicle.id', $this->a->id))->toMatchArray(['own' => true, 'votable' => false]);
        vtCast($this->a->id)->assertUnprocessable()->assertJsonPath('code', 'own_content')->assertJsonPath('message', 'Für dein eigenes Auto kannst du nicht abstimmen.');
        vtCast($this->b->id)->assertUnprocessable()->assertJsonPath('errors.vehicle_id.0', 'Dieses Auto steht für diesen Tag nicht zur Wahl.');
    });
});

describe('robustness (review nits)', function () {
    it('answers not_ready while another request freezes the round, never a 500, and votes once it is frozen', function () {
        // Held by "another request"; the read must not wait for it (the test clock is frozen, a wait would never end).
        $lock = Cache::lock('car_of_the_day:round:2026-07-15', 30);
        expect($lock->get())->toBeTrue();
        Sanctum::actingAs(vtVoter());

        $this->getJson('/api/v1/car-of-the-day/vote')->assertOk()->assertJsonPath('data.round.status', 'unavailable')
            ->assertJsonPath('data.round.unavailable_reason', 'not_ready')->assertJsonCount(0, 'data.round.candidates');
        vtCast($this->a->id)->assertUnprocessable()->assertJsonPath('errors.day.0', 'Die Abstimmung startet gerade. Versuch es in einem Moment noch einmal.');

        $lock->release();
        $this->getJson('/api/v1/car-of-the-day/vote')->assertOk()->assertJsonPath('data.round.status', 'open')->assertJsonCount(3, 'data.round.candidates');
        vtCast($this->a->id)->assertOk();
    });

    it('serialises every time of the round with its Europe/Berlin offset, in summer and in winter', function () {
        Sanctum::actingAs(vtVoter());
        $this->getJson('/api/v1/car-of-the-day/vote')->assertOk()
            ->assertJsonPath('data.round.opens_at', '2026-07-14T18:00:00+02:00')->assertJsonPath('data.round.closes_at', '2026-07-15T17:00:00+02:00');

        $this->travelTo(vtAt('19:00', '2026-12-01'));
        $this->getJson('/api/v1/car-of-the-day/vote')->assertOk()
            ->assertJsonPath('data.round.opens_at', '2026-12-01T18:00:00+01:00')->assertJsonPath('data.round.closes_at', '2026-12-02T17:00:00+01:00');
    });

    it('answers a deactivated account with 403 forbidden', function () {
        Sanctum::actingAs(vtVoter(['status' => 'deactivated']));

        vtCast($this->a->id)->assertForbidden()->assertJsonPath('code', 'forbidden');
        expect(CarOfTheDayVote::query()->count())->toBe(0);
    });

    it('does not let a candidate win whose photos moderation took down after the freeze', function () {
        Sanctum::actingAs(vtVoter());
        $this->getJson('/api/v1/car-of-the-day/vote');
        foreach ([$this->c->id, $this->c->id, $this->b->id] as $vehicleId) {
            Sanctum::actingAs(vtVoter());
            vtCast($vehicleId)->assertOk();
        }
        Media::query()->where('mediable_type', 'vehicle')->where('mediable_id', $this->c->id)->limit(1)->get()
            ->each(fn (Media $media) => $media->forceFill(['moderation_status' => 'rejected'])->save());

        $this->travelTo(vtAt('17:55', '2026-07-15'));
        app(CarOfTheDayRunner::class)->run();

        expect(CarOfTheDay::query()->where('day', '2026-07-15')->value('vehicle_id'))->toBe($this->b->id);
    });
});

describe('who may vote', function () {
    it('follows the authorisation matrix', function (Closure $actor, int $status, ?string $code, ?string $reason) {
        $this->getJson('/api/v1/car-of-the-day/vote');
        $actor();

        $response = vtCast($this->a->id)->assertStatus($status);

        if ($code !== null) {
            $response->assertJsonPath('code', $code);
            expect(CarOfTheDayVote::query()->count())->toBe(0);
        } else {
            $response->assertJsonPath('data.round.my_vote', $this->a->id);
        }

        if ($reason !== null) {
            $this->getJson('/api/v1/car-of-the-day/vote')->assertOk()->assertJsonPath('data.round.can_vote', false)->assertJsonPath('data.round.cannot_vote_reason', $reason);
        }
    })->with([
        'guest' => [fn () => null, 401, 'unauthenticated', null],
        'member' => [fn () => Sanctum::actingAs(vtVoter()), 200, null, null],
        'account of 3 days exactly' => [fn () => Sanctum::actingAs(vtVoter(['created_at' => now()->subDays(3)])), 200, null, null],
        'new account' => [fn () => Sanctum::actingAs(vtVoter(['created_at' => now()->subDays(2)])), 403, 'forbidden', 'account_too_new'],
        'unverified' => [fn () => Sanctum::actingAs(vtVoter(['email_verified_at' => null])), 403, 'email_not_verified', 'email_unverified'],
        'restricted from publishing' => [fn () => Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Publishing)->create(['created_at' => now()->subDays(10)])), 403, 'account_restricted', 'restricted'],
        'restricted from messaging only' => [fn () => Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Messaging)->create(['created_at' => now()->subDays(10)])), 200, null, null],
        'suspended' => [fn () => Sanctum::actingAs(User::factory()->suspended()->create(['created_at' => now()->subDays(10)])), 403, 'account_restricted', null],
        'sample account' => [fn () => Sanctum::actingAs(vtVoter(['is_sample' => true])), 403, 'forbidden', 'sample_account'],
    ]);

    it('tells a new account when it may vote', function () {
        $member = vtVoter(['created_at' => now()->subDays(2)]);
        Sanctum::actingAs($member);

        $this->getJson('/api/v1/car-of-the-day/vote')->assertOk()
            ->assertJsonPath('data.round.can_vote_from', CarbonImmutable::parse($member->created_at)->addDays(3)->setTimezone('Europe/Berlin')->toIso8601String())
            ->assertJsonPath('data.round.candidates.0.votable', false);
        vtCast($this->a->id)->assertForbidden()->assertJsonPath('message', 'Abstimmen kannst du drei Tage nach deiner Anmeldung.');
    });

    it('validates the body', function (array $body, string $field) {
        Sanctum::actingAs(vtVoter());

        $this->postJson('/api/v1/car-of-the-day/vote', $body)->assertUnprocessable()->assertJsonPath('code', 'validation_failed')->assertJsonValidationErrors($field);
    })->with([
        'no day' => [['vehicle_id' => '01jzzzzzzzzzzzzzzzzzzzzzzz'], 'day'],
        'bad day' => [['day' => '15.07.2026', 'vehicle_id' => '01jzzzzzzzzzzzzzzzzzzzzzzz'], 'day'],
        'no vehicle' => [['day' => '2026-07-15'], 'vehicle_id'],
        'not a ulid' => [['day' => '2026-07-15', 'vehicle_id' => 'abc'], 'vehicle_id'],
        'not a candidate' => [['day' => '2026-07-15', 'vehicle_id' => '01jzzzzzzzzzzzzzzzzzzzzzzz'], 'vehicle_id'],
    ]);
});

describe('one vote per account and day', function () {
    it('keeps one vote that changes until the close, and the same vote again changes nothing', function () {
        $member = vtVoter();
        Sanctum::actingAs($member);

        vtCast($this->a->id)->assertOk()->assertJsonPath('data.round.my_vote', $this->a->id);
        $first = CarOfTheDayVote::query()->sole();
        // Lower-case ULIDs, as every other table (HasUlids).
        expect($first->id)->toBe(strtolower($first->id))->toHaveLength(26);
        $this->travel(5)->minutes();
        vtCast($this->a->id)->assertOk();
        expect(CarOfTheDayVote::query()->sole()->updated_at->equalTo($first->updated_at))->toBeTrue();

        vtCast($this->b->id)->assertOk()->assertJsonPath('data.round.my_vote', $this->b->id);
        expect(CarOfTheDayVote::query()->count())->toBe(1)->and(CarOfTheDayVote::query()->sole()->vehicle_id)->toBe($this->b->id);

        $this->travelTo(vtAt('16:59', '2026-07-15'));
        vtCast($this->c->id)->assertOk()->assertJsonPath('data.round.my_vote', $this->c->id);
    });

    it('replays an Idempotency-Key', function () {
        Sanctum::actingAs(vtVoter());

        $first = vtCast($this->a->id, headers: ['Idempotency-Key' => 'vote-1'])->assertOk();
        $second = vtCast($this->a->id, headers: ['Idempotency-Key' => 'vote-1'])->assertOk();

        expect($second->json())->toBe($first->json())->and(CarOfTheDayVote::query()->count())->toBe(1);
    });

    it('is rate limited', function () {
        config(['speedclub.rate_limits.cotd_votes.max' => 2]);
        RateLimits::register();
        Sanctum::actingAs(vtVoter());

        vtCast($this->a->id)->assertOk();
        vtCast($this->b->id)->assertOk();
        vtCast($this->a->id)->assertStatus(429)->assertJsonPath('code', 'rate_limited');
    });
});

describe('the pick at 17:55', function () {
    it('takes the most-voted candidate, even below the Picker\'s first', function () {
        Sanctum::actingAs(vtVoter());
        $this->getJson('/api/v1/car-of-the-day/vote');
        $order = vtOrder();
        $pick = vtDecide([$order[2], $order[2], $order[0]]);

        expect($pick?->vehicle_id)->toBe($order[2])->and($pick?->by_vote)->toBeTrue()->and($pick?->source->value)->toBe('auto');
    });

    it('breaks a tie by the Picker\'s order', function () {
        Sanctum::actingAs(vtVoter());
        $this->getJson('/api/v1/car-of-the-day/vote');
        $order = vtOrder();

        $pick = vtDecide([$order[2], $order[1], $order[2], $order[1]]);

        expect($pick?->vehicle_id)->toBe($order[1])->and($pick?->by_vote)->toBeTrue();
    });

    it('drops the votes of removed and blocked accounts', function () {
        Sanctum::actingAs(vtVoter());
        $this->getJson('/api/v1/car-of-the-day/vote');
        $gone = [vtVoter(), vtVoter(), vtVoter()];
        foreach ($gone as $voter) {
            Sanctum::actingAs($voter);
            vtCast($this->c->id)->assertOk();
        }
        Sanctum::actingAs(vtVoter());
        vtCast($this->b->id)->assertOk();
        $gone[0]->delete();
        $gone[1]->forceFill(['status' => 'suspended'])->save();
        $gone[2]->forceFill(['status' => 'deactivated'])->save();

        $this->travelTo(vtAt('17:55', '2026-07-15'));
        app(CarOfTheDayRunner::class)->run();

        expect(CarOfTheDay::query()->where('day', '2026-07-15')->value('vehicle_id'))->toBe($this->b->id)
            ->and(collect(app(CarOfTheDayVotes::class)->staffTally('2026-07-15'))->firstWhere('vehicle_id', $this->c->id))->toMatchArray(['votes' => 3, 'counted' => 0]);
    });

    it('skips a candidate that may no longer be picked', function () {
        Sanctum::actingAs(vtVoter());
        $this->getJson('/api/v1/car-of-the-day/vote');
        foreach ([$this->c->id, $this->c->id, $this->b->id] as $vehicleId) {
            Sanctum::actingAs(vtVoter());
            vtCast($vehicleId)->assertOk();
        }
        $this->c->forceFill(['visibility' => 'private'])->save();
        app(VehicleSearchProjector::class)->rebuild($this->c->id);

        $this->travelTo(vtAt('17:55', '2026-07-15'));
        app(CarOfTheDayRunner::class)->run();

        expect(CarOfTheDay::query()->where('day', '2026-07-15')->value('vehicle_id'))->toBe($this->b->id);
    });

    it('uses the Picker\'s own rule when nobody voted', function () {
        Sanctum::actingAs(vtVoter());
        $this->getJson('/api/v1/car-of-the-day/vote');
        $first = vtOrder()[0];
        $pick = vtDecide([]);

        // The Picker's own pick is the round's first candidate.
        expect($pick?->vehicle_id)->toBe($first)->and($pick?->by_vote)->toBeFalse();
    });

    it('ignores the votes while the flag is off', function () {
        Sanctum::actingAs(vtVoter());
        $this->getJson('/api/v1/car-of-the-day/vote');
        $order = vtOrder();
        foreach ([$order[2], $order[2]] as $vehicleId) {
            Sanctum::actingAs(vtVoter());
            vtCast($vehicleId)->assertOk();
        }
        vtFlag(false);

        $this->travelTo(vtAt('17:55', '2026-07-15'));
        app(CarOfTheDayRunner::class)->run();

        expect(CarOfTheDay::query()->where('day', '2026-07-15')->value('vehicle_id'))->toBe($order[0])
            ->and(CarOfTheDay::query()->where('day', '2026-07-15')->value('by_vote'))->toBeFalsy();
    });

    it('lets a staff choice and a staff skip win over the votes, audited as before', function (string $kind) {
        Sanctum::actingAs(vtVoter());
        $this->getJson('/api/v1/car-of-the-day/vote');
        foreach ([$this->c->id, $this->c->id] as $vehicleId) {
            Sanctum::actingAs(vtVoter());
            vtCast($vehicleId)->assertOk();
        }
        seedStaffRoles();
        $staff = staffWithRole('content_editor');

        if ($kind === 'choice') {
            app(OverrideCarOfTheDay::class)->handle($staff, '2026-07-15', $this->b->id, 'Redaktion wählt');
        } else {
            app(SkipCarOfTheDay::class)->handle($staff, '2026-07-15', 'Kein Auto heute');
        }

        Sanctum::actingAs(vtVoter());
        $this->getJson('/api/v1/car-of-the-day/vote')->assertOk()->assertJsonPath('data.round.status', 'unavailable')
            ->assertJsonPath('data.round.unavailable_reason', 'staff_decided');
        vtCast($this->c->id)->assertUnprocessable()->assertJsonPath('errors.day.0', 'Für diesen Tag gibt es keine Abstimmung.');

        $this->travelTo(vtAt('17:55', '2026-07-15'));
        app(CarOfTheDayRunner::class)->run();
        $row = CarOfTheDay::query()->where('day', '2026-07-15')->sole();

        expect($row->by_vote)->toBeFalse()
            ->and($kind === 'choice' ? $row->vehicle_id : $row->skipped)->toBe($kind === 'choice' ? $this->b->id : true)
            ->and(AuditEvent::query()->where('action', $kind === 'choice' ? 'car_of_the_day.overridden' : 'car_of_the_day.skipped')->count())->toBe(1);
    })->with(['choice', 'skip']);

    it('shows the winner and the reader\'s vote after the publication, still without a count', function () {
        $voter = vtVoter();
        $this->getJson('/api/v1/car-of-the-day/vote');
        Sanctum::actingAs($voter);
        vtCast($this->b->id)->assertOk();

        $this->travelTo(vtAt('18:00', '2026-07-15'));
        app(CarOfTheDayRunner::class)->run();
        Sanctum::actingAs($voter);

        $response = $this->getJson('/api/v1/car-of-the-day/vote')->assertOk()
            ->assertJsonPath('data.round.day', '2026-07-16')
            ->assertJsonPath('data.round.my_vote', null)
            ->assertJsonPath('data.last_result.day', '2026-07-15')
            ->assertJsonPath('data.last_result.my_vote', $this->b->id)
            ->assertJsonPath('data.last_result.winner.id', $this->b->id)
            ->assertJsonPath('data.last_result.by_vote', true);

        expect(json_encode($response->json(), JSON_THROW_ON_ERROR))->not->toContain('"votes"')->not->toContain('"counted"');
    });

    it('freezes the next round in the 18:00 run, without the car that is Car of the Day now', function () {
        $this->travelTo(vtAt('18:05', '2026-07-15'));
        app(CarOfTheDayRunner::class)->run();
        $today = CarOfTheDay::query()->where('day', '2026-07-15')->value('vehicle_id');
        $next = CarOfTheDayCandidate::query()->where('day', '2026-07-16')->orderBy('position')->pluck('vehicle_id')->all();

        // Three real cars, one of them today's (gap_days): the other two make the round; the sample never does.
        expect($today)->not->toBeNull()
            ->and($next)->toHaveCount(2)->not->toContain($today)->not->toContain($this->sample->id);
    });
});

// ADR-535: outside production a round with fewer than min_candidates real cars is filled up with sample builds (real ones first), and a
// sample may win the count there; production never takes a sample (the round stays unavailable). Sample accounts never vote (V4).
describe('sample candidates outside production (ADR-535)', function () {
    beforeEach(function () {
        // Only one real car meets the pick's minimums; two samples do.
        giftScore($this->b, 100);
        giftScore($this->c, 100);
        $this->sample2 = giftCar(giftMember(['bundesland' => Bundesland::SN, 'is_sample' => true]), 950, attributes: ['is_sample' => true]);
    });

    it('fills a short round with the best samples after the real car and marks them is_sample in the payload', function () {
        Sanctum::actingAs(vtVoter());

        $candidates = $this->getJson('/api/v1/car-of-the-day/vote')->assertOk()
            ->assertJsonPath('data.round.status', 'open')
            ->assertJsonPath('data.round.unavailable_reason', null)
            ->json('data.round.candidates');

        expect(collect($candidates)->pluck('vehicle.id')->all())->toBe([$this->a->id, $this->sample->id, $this->sample2->id])
            ->and(collect($candidates)->pluck('vehicle.is_sample')->all())->toBe([false, true, true])
            ->and(collect($candidates)->pluck('votable')->all())->toBe([true, true, true]);
    });

    it('lets a sample win the count outside production, as a badged sample row decided by the vote', function () {
        $row = vtDecide([$this->sample->id, $this->sample->id, $this->a->id]);

        expect($row?->vehicle_id)->toBe($this->sample->id)
            ->and($row?->is_sample)->toBeTrue()
            ->and($row?->by_vote)->toBeTrue();
    });

    it('fills with a one-photo sample outside production, while a one-photo real build still does not qualify', function () {
        $sparse = giftCar(giftMember(['bundesland' => Bundesland::BW, 'is_sample' => true]), 980, photos: 1, attributes: ['is_sample' => true]);
        $realSparse = giftCar(giftMember(['bundesland' => Bundesland::HE]), 999, photos: 1);

        $ids = app(CarOfTheDayPicker::class)->ranked('2026-07-15', 3);

        // The real car first; then the best samples by rotation, the one-photo sample among them; never the one-photo real build.
        expect($ids[0])->toBe($this->a->id)
            ->and($ids)->toHaveCount(3)->toContain($sparse->id)->not->toContain($realSparse->id);
    });

    it('never takes a sample in production: the short round stays unavailable', function () {
        app()->detectEnvironment(fn (): string => 'production');

        app(CarOfTheDayVoting::class)->prepare('2026-07-15');

        expect(vtOrder())->toBe([])
            ->and(app(CarOfTheDayVoting::class)->unavailable('2026-07-15'))->toBe(CarOfTheDayRoundUnavailable::TooFewCandidates)
            ->and(app(CarOfTheDayPicker::class)->ranked('2026-07-15', 3))->toBe([$this->a->id]);

        app()->detectEnvironment(fn (): string => 'testing');
    });

    it('never lets a sample win in production, even from a round frozen before', function () {
        // A round frozen outside production (e.g. a staging copy), counted in production: the sample's votes do not decide the day.
        test()->getJson('/api/v1/car-of-the-day/vote');
        Sanctum::actingAs(vtVoter());
        vtCast($this->sample->id)->assertOk();
        Sanctum::actingAs(vtVoter());
        vtCast($this->sample->id)->assertOk();

        app()->detectEnvironment(fn (): string => 'production');
        expect(app(CarOfTheDayVotes::class)->winner('2026-07-15'))->toBeNull();
        app()->detectEnvironment(fn (): string => 'testing');
    });
});

describe('staff data and the export', function () {
    it('gives staff the counts per candidate and day, all and counted', function () {
        Sanctum::actingAs(vtVoter());
        $this->getJson('/api/v1/car-of-the-day/vote');
        foreach ([$this->a->id, $this->a->id, $this->b->id] as $vehicleId) {
            Sanctum::actingAs(vtVoter());
            vtCast($vehicleId)->assertOk();
        }

        $tally = app(CarOfTheDayVotes::class)->staffTally('2026-07-15');
        $days = app(CarOfTheDayVotes::class)->staffDays('2026-07-01', '2026-07-31');

        expect($tally)->toHaveCount(3)
            ->and(collect($tally)->firstWhere('vehicle_id', $this->a->id))->toMatchArray(['votes' => 2, 'counted' => 2])
            ->and(collect($tally)->firstWhere('vehicle_id', $this->b->id))->toMatchArray(['votes' => 1, 'counted' => 1])
            ->and(collect($tally)->pluck('position')->all())->toBe([1, 2, 3])
            ->and(array_keys($days))->toBe(['2026-07-15'])->and($days['2026-07-15'])->toBe($tally);
    });

    it('puts the member\'s own votes into the data export, and nobody else\'s', function () {
        $member = vtVoter();
        Sanctum::actingAs($member);
        vtCast($this->a->id)->assertOk();
        Sanctum::actingAs(vtVoter());
        vtCast($this->b->id)->assertOk();

        $files = app(ExportContents::class)->documents($member);

        expect($files)->toHaveKey('car_of_the_day_votes.json')
            ->and($files['car_of_the_day_votes.json'])->toHaveCount(1)
            ->and($files['car_of_the_day_votes.json'][0])->toMatchArray(['day' => '2026-07-15', 'vehicle' => $this->a->public_id]);
    });
});
