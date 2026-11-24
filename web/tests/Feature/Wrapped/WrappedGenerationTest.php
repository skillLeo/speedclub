<?php

use App\Actions\Wrapped\GenerateWrappedForUser;
use App\Enums\Bundesland;
use App\Jobs\Wrapped\GenerateWrapped;
use App\Models\AuditEvent;
use App\Models\Staff;
use App\Models\User;
use App\Models\Wrapped;
use App\Services\Wrapped\Season;
use App\Services\Wrapped\WrappedCardImages;
use App\Services\Wrapped\WrappedGenerator;
use App\Services\Wrapped\WrappedReleases;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;

require_once __DIR__.'/WrappedTestHelpers.php';

/**
 * M5.9e (m5.9e contract §2, §8): chunked, resumable, idempotent generation; only members with activity; samples never in production;
 * the command and the schedule's "due"; the admin preview action and its audit.
 */
beforeEach(function () {
    wrFlags();
    $this->travelTo(wrNow());
    Storage::fake(config()->string('speedclub.media.private_disk'));
});

function wrActive(array $attributes = []): User
{
    $member = User::factory()->create($attributes);
    wrMod(wrCar($member));

    return $member;
}

it('writes one row per active member and season, and the same data writes the same row', function () {
    $member = wrActive();
    $generator = app(WrappedGenerator::class);

    $first = $generator->generate($member, Season::from(WR_SEASON));
    $this->travel(1)->hours();
    $second = $generator->generate($member, Season::from(WR_SEASON));

    expect(Wrapped::query()->count())->toBe(1)
        ->and($second->id)->toBe($first->id)
        ->and($second->payload)->toEqual($first->payload)
        ->and($second->season_key)->toBe(WR_SEASON)
        ->and($second->generated_at->greaterThan($first->generated_at))->toBeTrue();
});

it('keeps viewed_at and shared_count when it writes the row again', function () {
    $member = wrActive();
    $generator = app(WrappedGenerator::class);
    $row = $generator->generate($member, Season::from(WR_SEASON));
    $row->forceFill(['viewed_at' => now(), 'shared_count' => 3])->save();

    $again = $generator->generate($member, Season::from(WR_SEASON));

    expect($again->shared_count)->toBe(3)->and($again->viewed_at)->not->toBeNull();
});

it('removes a stale row once the member has nothing in the season any more', function () {
    $member = User::factory()->create();
    $mod = wrMod(wrCar($member));
    $generator = app(WrappedGenerator::class);
    $generator->generate($member, Season::from(WR_SEASON));
    $mod->delete();

    expect($generator->generate($member, Season::from(WR_SEASON)))->toBeNull()
        ->and(Wrapped::query()->count())->toBe(0);
});

it('never generates a sample member in production, and marks one outside it', function () {
    $sample = wrActive(['is_sample' => true]);

    expect(app(WrappedGenerator::class)->generate($sample, Season::from(WR_SEASON))?->is_sample)->toBeTrue();

    Wrapped::query()->delete();
    app()->detectEnvironment(fn () => 'production');

    try {
        expect(app(WrappedGenerator::class)->generate($sample, Season::from(WR_SEASON)))->toBeNull()
            ->and(app(WrappedGenerator::class)->run(Season::from(WR_SEASON), 'prod')['written'])->toBe(0)
            ->and(Wrapped::query()->count())->toBe(0);
    } finally {
        app()->detectEnvironment(fn () => 'testing');
    }
});

it('walks the members in resumable passes and does nothing more once done', function () {
    $members = collect(range(1, 3))->map(fn () => wrActive());
    User::factory()->create();
    config(['speedclub.wrapped.chunk' => 2, 'speedclub.wrapped.seconds' => 0]);
    $generator = app(WrappedGenerator::class);
    $season = Season::from(WR_SEASON);

    // A pass of 0 s handles one member, keeps its cursor and the next pass continues after it.
    $passes = [];

    do {
        $passes[] = $result = $generator->run($season, 'night');
    } while (! $result['done'] && count($passes) < 10);

    expect(array_column($passes, 'written'))->toBe([1, 1, 1, 0])
        ->and(Wrapped::query()->pluck('user_id')->sort()->values()->all())->toBe($members->pluck('id')->sort()->values()->all())
        ->and(Cache::get(WrappedGenerator::stateKey($season, 'night')))->toMatchArray(['done' => true])
        ->and($generator->run($season, 'night'))->toBe(['done' => true, 'members' => 0, 'written' => 0]);

    $generator->restart($season, 'night');
    config(['speedclub.wrapped.seconds' => 40]);

    expect($generator->run($season, 'night'))->toMatchArray(['done' => true, 'written' => 3])
        ->and(Wrapped::query()->count())->toBe(3);
});

it('continues an unfinished pass on the next day instead of starting over, then refreshes in a new pass (CR-P5G-05)', function () {
    $members = collect(range(1, 3))->map(fn () => wrActive())->sortBy('id')->values();
    config(['speedclub.wrapped.chunk' => 1, 'speedclub.wrapped.seconds' => 0]);
    $generator = app(WrappedGenerator::class);
    $season = Season::from(WR_SEASON);
    $key = WrappedGenerator::runKey(wrIn('2027-11-05 10:00:00'));

    expect($generator->run($season, $key)['written'])->toBe(1)
        ->and(Wrapped::query()->pluck('user_id')->all())->toBe([$members[0]->id]);

    // The next morning: member 2, not member 1 again.
    $this->travelTo(wrNow()->addDay());
    expect($generator->run($season, $key)['written'])->toBe(1)
        ->and(Wrapped::query()->orderBy('user_id')->pluck('user_id')->all())->toBe([$members[0]->id, $members[1]->id]);

    $generator->run($season, $key);
    expect($generator->run($season, $key))->toMatchArray(['done' => true, 'written' => 0])
        ->and(WrappedGenerator::passCompleted($season, $key))->toBeTrue()
        ->and($generator->run($season, $key))->toBe(['done' => true, 'members' => 0, 'written' => 0]);

    // A later day starts a fresh pass from the first member, so the payloads follow the data until the release.
    $this->travelTo(wrNow()->addDays(2));
    $first = Wrapped::query()->where('user_id', $members[0]->id)->value('generated_at');
    expect($generator->run($season, $key))->toMatchArray(['done' => false, 'members' => 1])
        ->and(Wrapped::query()->where('user_id', $members[0]->id)->value('generated_at'))->not->toEqual($first);
});

it('keeps a released season due until its pass for that release is done, and warns meanwhile (CR-P5G-06)', function () {
    wrActive();
    wrActive();
    config(['speedclub.wrapped.chunk' => 1, 'speedclub.wrapped.seconds' => 0]);
    // Staff set the date only an hour ago, and it has just come.
    wrRelease([WR_SEASON => wrNow()->subMinute()->toIso8601String()]);
    Log::spy();

    expect(app(WrappedReleases::class)->due())->toBe([WR_SEASON]);

    $this->artisan('speedclub:wrapped:generate', ['season' => 'due'])->expectsOutputToContain('continues with the next run')->assertSuccessful();
    Log::shouldHaveReceived('warning')->withArgs(fn (string $message, array $context): bool => str_contains($message, 'not done') && $context['season'] === WR_SEASON)->once();
    expect(app(WrappedReleases::class)->due())->toBe([WR_SEASON]);

    $this->artisan('speedclub:wrapped:generate', ['season' => 'due'])->assertSuccessful();
    $this->artisan('speedclub:wrapped:generate', ['season' => 'due'])->assertSuccessful();

    expect(Wrapped::query()->count())->toBe(2)
        ->and(app(WrappedReleases::class)->due())->toBe([]);

    // Long past: never due again, done or not.
    Cache::flush();
    $this->travelTo(wrNow()->addDays(8));
    expect(app(WrappedReleases::class)->due())->toBe([]);
});

it('generates --user for every due season (CR-P5G-16)', function () {
    $member = wrActive(['username' => 'wrapped.both']);
    wrRelease([WR_SEASON => wrNow()->addDays(2)->toIso8601String(), '2027-jahr' => wrNow()->addDays(3)->toIso8601String()]);

    $this->artisan('speedclub:wrapped:generate', ['season' => 'due', '--user' => 'wrapped.both'])->assertSuccessful();

    expect(Wrapped::query()->where('user_id', $member->id)->orderBy('season_key')->pluck('season_key')->all())->toBe(['2027-jahr', WR_SEASON]);
});

it('reads a Bundesland\'s percentile group once per pass, not once per member (CR-P5G-05)', function () {
    foreach (range(1, 22) as $i) {
        $member = User::factory()->create(['bundesland' => Bundesland::NW]);
        $car = wrCar($member);
        wrMod($car);
        wrScore($car, 300 + $i * 10);
    }

    $groups = 0;
    DB::listen(function ($query) use (&$groups): void {
        $groups += str_contains($query->sql, 'as best') ? 1 : 0;
    });

    $result = app(WrappedGenerator::class)->run(Season::from(WR_SEASON), 'manual');

    expect($result['written'])->toBe(22)
        ->and($groups)->toBe(1)
        ->and(Wrapped::query()->get()->filter(fn (Wrapped $wrapped): bool => in_array('percentile', array_column($wrapped->cards(), 'kind'), true)))->toHaveCount(11);
});

it('leaves suspended and deactivated members out of a pass (CR-P5G-22)', function () {
    $active = wrActive();
    wrActive(['status' => 'suspended']);
    wrActive(['status' => 'deactivated']);

    app(WrappedGenerator::class)->run(Season::from(WR_SEASON), 'manual');

    expect(Wrapped::query()->pluck('user_id')->all())->toBe([$active->id]);
});

it('does not run while another pass of the season holds the lock', function () {
    wrActive();
    $lock = Cache::lock('wrapped:generate:lock:'.WR_SEASON, 120);
    $lock->get();

    expect(app(WrappedGenerator::class)->run(Season::from(WR_SEASON), 'night'))->toBeNull();

    $lock->release();
});

it('queues the next pass of an on-demand job until the season is done', function () {
    Queue::fake();
    wrActive();
    wrActive();
    config(['speedclub.wrapped.chunk' => 1, 'speedclub.wrapped.seconds' => 0]);

    (new GenerateWrapped(WR_SEASON, 'manual'))->handle(app(WrappedGenerator::class));

    Queue::assertPushed(GenerateWrapped::class, fn (GenerateWrapped $job) => $job->seasonId === WR_SEASON && $job->runId === 'manual');
});

it('generates one member or every member from the command', function () {
    $member = wrActive(['username' => 'wrapped.one']);
    wrActive();

    $this->artisan('speedclub:wrapped:generate', ['season' => WR_SEASON, '--user' => 'wrapped.one'])
        ->expectsOutputToContain('@wrapped.one has 3 cards')
        ->assertSuccessful();
    expect(Wrapped::query()->pluck('user_id')->all())->toBe([$member->id]);

    $this->artisan('speedclub:wrapped:generate', ['season' => WR_SEASON])->expectsOutputToContain('done')->assertSuccessful();
    expect(Wrapped::query()->count())->toBe(2);

    $this->artisan('speedclub:wrapped:generate', ['season' => '2027-winter'])->assertFailed();
});

it('generates the seasons whose release is near when asked for "due"', function () {
    wrActive();
    wrRelease([WR_SEASON => '2027-11-05T10:00:00+01:00', '2027-jahr' => '2027-12-28T10:00:00+01:00']);

    $this->artisan('speedclub:wrapped:generate', ['season' => 'due'])->assertSuccessful();

    expect(Wrapped::query()->pluck('season_key')->all())->toBe([WR_SEASON]);

    // Released yesterday (CR-P5G-06): due until the pass for that release is done, then not any more.
    wrRelease([WR_SEASON => '2027-11-01T10:00:00+01:00']);
    $this->artisan('speedclub:wrapped:generate', ['season' => 'due'])->expectsOutputToContain(WR_SEASON.': done')->assertSuccessful();
    $this->artisan('speedclub:wrapped:generate', ['season' => 'due'])->expectsOutputToContain('No season is due')->assertSuccessful();

    // Released more than generate_days_before days ago: never due.
    Cache::flush();
    wrRelease([WR_SEASON => '2027-10-25T10:00:00+02:00']);
    $this->artisan('speedclub:wrapped:generate', ['season' => 'due'])->expectsOutputToContain('No season is due')->assertSuccessful();
});

it('lets staff generate one member\'s preview and audits it without the payload', function () {
    $member = wrActive();
    $staff = Staff::factory()->create();

    $wrapped = app(GenerateWrappedForUser::class)($staff, $member, WR_SEASON);
    $event = AuditEvent::query()->where('action', GenerateWrappedForUser::AUDIT_EVENT)->sole();

    expect($wrapped)->toBeInstanceOf(Wrapped::class)
        ->and($event->actor_type->value)->toBe('staff')
        ->and((string) $event->actor_id)->toBe((string) $staff->id)
        ->and($event->target_type)->toBe('user')
        ->and($event->target_id)->toBe($member->id)
        ->and($event->after)->toBe(['cards' => ['intro', 'top_mod', 'share'], 'generated' => true, 'season_key' => WR_SEASON]);

    $quiet = User::factory()->create();
    expect(app(GenerateWrappedForUser::class)($staff, $quiet, WR_SEASON))->toBeNull()
        ->and(AuditEvent::query()->where('action', GenerateWrappedForUser::AUDIT_EVENT)->count())->toBe(2);
});

it('drops the cached card images when the payload changes', function () {
    $member = wrActive();
    wrRelease();
    $generator = app(WrappedGenerator::class);
    $wrapped = $generator->generate($member, Season::from(WR_SEASON));
    app(WrappedCardImages::class)->png($wrapped, 1);
    $disk = Storage::disk(config()->string('speedclub.media.private_disk'));

    expect($disk->allFiles('wrapped'))->toHaveCount(1);

    $generator->generate($member, Season::from(WR_SEASON));
    expect($disk->allFiles('wrapped'))->toHaveCount(1);

    wrMod(wrCar($member), 'interior');
    $generator->generate($member, Season::from(WR_SEASON));
    expect($disk->allFiles('wrapped'))->toHaveCount(0);
});
