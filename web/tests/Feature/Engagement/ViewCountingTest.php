<?php

use App\Actions\Admin\Members\StartViewAs;
use App\Enums\RestrictionType;
use App\Enums\VehicleStatus;
use App\Enums\Visibility;
use App\Models\Block;
use App\Models\QrCode;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\ViewEvent;
use App\Models\ViewSalt;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;

require_once __DIR__.'/EngagementTestHelpers.php';
require_once __DIR__.'/../Admin/Actions/Helpers.php';

/**
 * M5.7 view counting (10 §6.1, m5.7-contract §2, §3.1, §14): one view per person, page and Europe/Berlin day with the source of the first,
 * the person only as a hash keyed with a salt of the day; never the owner, staff in view-as, samples, hidden or blocked pages, machines,
 * prefetches or QA renders; nothing at all while `insights` is off. The beacon always answers 204.
 */
beforeEach(function () {
    $this->withoutDefer();
    engFlag();
    $this->owner = User::factory()->create(['username' => 'max.e46']);
    $this->car = publishedVehicle($this->owner, ['visibility' => Visibility::Public]);
});

describe('the beacon', function () {
    it('counts a guest once per day, and another guest again', function () {
        engVehicleView(null, $this->car)->assertNoContent();
        engVehicleView(null, $this->car)->assertNoContent();

        expect(engVehicleViews($this->car))->toBe(['app' => 1]);

        engVehicleView(null, $this->car, headers: ['User-Agent' => ENG_BROWSER.' other'])->assertNoContent();

        expect(engVehicleViews($this->car))->toBe(['app' => 2])
            ->and(ViewEvent::query()->count())->toBe(2);
    });

    it('counts a member once per day, again the next day, and keeps the source of the first view', function () {
        $viewer = User::factory()->create();

        engVehicleView($viewer, $this->car, 'shared_link');
        engVehicleView($viewer, $this->car, 'app');

        expect(engVehicleViews($this->car))->toBe(['shared_link' => 1]);

        $this->travel(1)->day();
        engVehicleView($viewer, $this->car, 'app');

        expect(engVehicleViews($this->car))->toBe(['shared_link' => 1, 'app' => 1]);
    });

    it('counts profiles by username', function () {
        engBeacon(User::factory()->create(), ['subject' => 'profile', 'username' => 'max.e46', 'source' => 'web'])->assertNoContent();

        expect(engProfileViews($this->owner))->toBe(['web' => 1]);
    });

    it('counts at most 3 new guest views per address and page a day, however the user agent rotates (review SF-1)', function () {
        foreach (range(1, 10) as $i) {
            engVehicleView(null, $this->car, headers: ['User-Agent' => ENG_BROWSER.' rotate/'.$i])->assertNoContent();
        }

        expect(engVehicleViews($this->car))->toBe(['app' => 3])
            // The cap is per page: the same address may still count on another car, and members are not capped by the address.
            ->and(engVehicleView(null, $other = publishedVehicle(User::factory()->create()), headers: ['User-Agent' => ENG_BROWSER.' other'])->status())->toBe(204)
            ->and(engVehicleViews($other))->toBe(['app' => 1]);

        foreach (User::factory()->count(4)->create() as $member) {
            engVehicleView($member, $this->car);
        }

        expect(engVehicleViews($this->car))->toBe(['app' => 7]);

        // A new Berlin day, a new salt: the address may count again.
        $this->travel(1)->day();
        engVehicleView(null, $this->car, headers: ['User-Agent' => ENG_BROWSER.' next-day']);
        expect(engVehicleViews($this->car)['app'])->toBe(8);
    });

    it('counts the Android app, whose user agent is okhttp', function () {
        engVehicleView(null, $this->car, headers: ['User-Agent' => ENG_ANDROID_APP]);

        expect(engVehicleViews($this->car))->toBe(['app' => 1]);
    });

    it('counts nothing that is not a person looking at a page they may see, and still answers 204', function (Closure $setup) {
        [$viewer, $body, $headers] = $setup($this->owner, $this->car) + [2 => []];

        engBeacon($viewer, $body, $headers)->assertNoContent();

        expect(DB::table('view_events')->count())->toBe(0)
            ->and(DB::table('view_days')->count())->toBe(0);
    })->with([
        'the owner' => [fn (User $owner, Vehicle $car): array => [$owner, ['subject' => 'vehicle', 'id' => $car->id, 'source' => 'app']]],
        'the owner on the profile' => [fn (User $owner): array => [$owner, ['subject' => 'profile', 'username' => 'max.e46', 'source' => 'app']]],
        'a member the owner blocked' => [function (User $owner, Vehicle $car): array {
            $member = User::factory()->create();
            Block::factory()->create(['blocker_id' => $owner->id, 'blocked_id' => $member->id]);

            return [$member, ['subject' => 'vehicle', 'id' => $car->id, 'source' => 'app']];
        }],
        'a member who blocked the owner' => [function (User $owner, Vehicle $car): array {
            $member = User::factory()->create();
            Block::factory()->create(['blocker_id' => $member->id, 'blocked_id' => $owner->id]);

            return [$member, ['subject' => 'profile', 'username' => 'max.e46', 'source' => 'app']];
        }],
        'a private car' => [function (User $owner, Vehicle $car): array {
            $car->forceFill(['visibility' => Visibility::Private])->save();

            return [null, ['subject' => 'vehicle', 'id' => $car->id, 'source' => 'app']];
        }],
        'a draft' => [function (User $owner, Vehicle $car): array {
            $car->forceFill(['status' => VehicleStatus::Draft])->save();

            return [null, ['subject' => 'vehicle', 'id' => $car->id, 'source' => 'app']];
        }],
        'a deleted car' => [function (User $owner, Vehicle $car): array {
            $car->delete();

            return [null, ['subject' => 'vehicle', 'id' => $car->id, 'source' => 'app']];
        }],
        'an unknown car' => [fn (): array => [null, ['subject' => 'vehicle', 'id' => '01JAAAAAAAAAAAAAAAAAAAAAAA', 'source' => 'app']]],
        'an unknown member' => [fn (): array => [null, ['subject' => 'profile', 'username' => 'nobody.here', 'source' => 'app']]],
        'a sample car' => [function (User $owner, Vehicle $car): array {
            $car->forceFill(['is_sample' => true])->save();

            return [null, ['subject' => 'vehicle', 'id' => $car->id, 'source' => 'app']];
        }],
        'a sample owner' => [function (User $owner, Vehicle $car): array {
            $owner->forceFill(['is_sample' => true])->save();

            return [null, ['subject' => 'profile', 'username' => 'max.e46', 'source' => 'app']];
        }],
        'a sample viewer' => [fn (User $owner, Vehicle $car): array => [User::factory()->create(['is_sample' => true]), ['subject' => 'vehicle', 'id' => $car->id, 'source' => 'app']]],
        'a headless browser' => [fn (User $owner, Vehicle $car): array => [null, ['subject' => 'vehicle', 'id' => $car->id, 'source' => 'web'], ['User-Agent' => 'Mozilla/5.0 HeadlessChrome/120.0']]],
        'a Playwright run' => [fn (User $owner, Vehicle $car): array => [null, ['subject' => 'vehicle', 'id' => $car->id, 'source' => 'web'], ['User-Agent' => ENG_BROWSER.' Playwright/1.50']]],
        'a prefetch' => [fn (User $owner, Vehicle $car): array => [null, ['subject' => 'vehicle', 'id' => $car->id, 'source' => 'web'], ['Sec-Purpose' => 'prefetch']]],
        'a QA render of the member web' => [fn (User $owner, Vehicle $car): array => [null, ['subject' => 'vehicle', 'id' => $car->id, 'source' => 'web'], ['Referer' => 'http://localhost/app/v/x?qaTheme=black']]],
        'an unverified owner (no public page)' => [function (User $owner, Vehicle $car): array {
            $owner->forceFill(['email_verified_at' => null])->save();

            return [null, ['subject' => 'vehicle', 'id' => $car->id, 'source' => 'app']];
        }],
    ]);

    it('counts nothing while the flag is off', function () {
        engFlag(false);

        engVehicleView(null, $this->car)->assertNoContent();

        expect(DB::table('view_events')->count())->toBe(0)
            ->and(ViewSalt::query()->count())->toBe(0);
    });

    it('counts a restricted or unverified member like anybody', function () {
        engVehicleView(User::factory()->restrictedFrom(RestrictionType::Publishing)->create(), $this->car);
        engVehicleView(User::factory()->unverified()->create(), $this->car);

        expect(engVehicleViews($this->car))->toBe(['app' => 2]);
    });

    it('never counts staff in view-as', function () {
        Mail::fake();
        $viewer = User::factory()->create();
        $token = app(StartViewAs::class)->handle(m31Staff('admin'), $viewer, m32Reason(), false)['token'];
        app('auth')->forgetGuards();

        // View-as is read-only on every write route (RestrictViewAs): 403 view_as_read_only, and nothing is counted either way.
        $status = $this->withToken($token)->postJson('/api/v1/views', ['subject' => 'vehicle', 'id' => $this->car->id, 'source' => 'app'], ['User-Agent' => ENG_BROWSER])->status();

        expect($status)->toBeIn([204, 403])
            ->and(DB::table('view_events')->count())->toBe(0);
    });

    it('validates the body', function (array $body, string $field) {
        engBeacon(null, $body)->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        'no subject' => [['id' => '01JAAAAAAAAAAAAAAAAAAAAAAA', 'source' => 'app'], 'subject'],
        'unknown subject' => [['subject' => 'event', 'id' => '01JAAAAAAAAAAAAAAAAAAAAAAA', 'source' => 'app'], 'subject'],
        'no source' => [['subject' => 'vehicle', 'id' => '01JAAAAAAAAAAAAAAAAAAAAAAA'], 'source'],
        'unknown source' => [['subject' => 'vehicle', 'id' => '01JAAAAAAAAAAAAAAAAAAAAAAA', 'source' => 'tv'], 'source'],
        'vehicle without id' => [['subject' => 'vehicle', 'source' => 'app'], 'id'],
        'vehicle id not a ULID' => [['subject' => 'vehicle', 'id' => '42', 'source' => 'app'], 'id'],
        'profile without username' => [['subject' => 'profile', 'source' => 'app'], 'username'],
        'username too long' => [['subject' => 'profile', 'username' => str_repeat('a', 41), 'source' => 'app'], 'username'],
        'username with other characters' => [['subject' => 'profile', 'username' => 'max e46/../', 'source' => 'app'], 'username'],
    ]);

    it('is rate limited per guest address', function () {
        for ($i = 0; $i < 60; $i++) {
            engVehicleView(null, $this->car)->assertNoContent();
        }

        engVehicleView(null, $this->car)->assertTooManyRequests()->assertJsonPath('code', 'rate_limited');
    });
});

describe('the public pages', function () {
    it('counts WEB-01 as web, and a shared link as geteilter Link', function () {
        $this->get('/v/'.$this->car->canonicalSlug(), ['User-Agent' => ENG_BROWSER])->assertOk();
        $this->get('/v/'.$this->car->canonicalSlug().'?via=share', ['User-Agent' => ENG_BROWSER.' 2'])->assertOk();

        expect(engVehicleViews($this->car))->toBe(['web' => 1, 'shared_link' => 1]);
    });

    it('counts WEB-02 as a profile view', function () {
        $this->get('/u/max.e46?via=share', ['User-Agent' => ENG_BROWSER])->assertOk();

        expect(engProfileViews($this->owner))->toBe(['shared_link' => 1]);
    });

    it('leaves out crawlers, link previews, prefetches and QA renders', function (array $headers, string $query) {
        $this->get('/v/'.$this->car->canonicalSlug().$query, $headers)->assertOk();

        expect(DB::table('view_events')->count())->toBe(0);
    })->with([
        'Googlebot' => [['User-Agent' => 'Mozilla/5.0 (compatible; Googlebot/2.1)'], ''],
        'WhatsApp preview' => [['User-Agent' => 'WhatsApp/2.23.20.0'], ''],
        'no user agent' => [['User-Agent' => ''], ''],
        'prefetch' => [['User-Agent' => ENG_BROWSER, 'Purpose' => 'prefetch'], ''],
        'QA matrix' => [['User-Agent' => ENG_BROWSER], '?qaTheme=carbon'],
    ]);

    it('counts a sticker scan as Sticker-Scan before the redirect, and the page that follows adds nothing', function () {
        $code = QrCode::factory()->create(['vehicle_id' => $this->car->id])->code;

        $this->get('/c/'.$code, ['User-Agent' => ENG_BROWSER])->assertRedirect();
        $this->get('/v/'.$this->car->canonicalSlug(), ['User-Agent' => ENG_BROWSER])->assertOk();

        expect(engVehicleViews($this->car))->toBe(['sticker_scan' => 1]);
    });

    it('does not count the API read of the page (prefetches and revalidations would inflate it)', function () {
        $this->getJson('/api/v1/public/vehicles/'.$this->car->canonicalSlug(), ['User-Agent' => ENG_BROWSER])->assertOk();

        expect(DB::table('view_events')->count())->toBe(0);
    });

    it('gives the page a share address with ?via=share and keeps the canonical one plain', function () {
        $page = $this->getJson('/api/v1/public/vehicles/'.$this->car->canonicalSlug())->assertOk();

        expect($page->json('data.share_url'))->toEndWith('/v/'.$this->car->canonicalSlug().'?via=share')
            ->and($page->json('data.canonical_url'))->toEndWith('/v/'.$this->car->canonicalSlug());

        expect($this->getJson('/api/v1/public/users/max.e46')->json('data.share_url'))->toEndWith('/u/max.e46?via=share');

        $html = (string) $this->get('/v/'.$this->car->canonicalSlug().'?via=share', ['User-Agent' => ENG_BROWSER])->getContent();
        preg_match('/<link rel="canonical" href="([^"]+)"/', $html, $canonical);

        expect($canonical[1] ?? null)->toEndWith('/v/'.$this->car->canonicalSlug())
            ->and($html)->toMatch('#data-share-url="[^"]*/v/'.preg_quote($this->car->canonicalSlug(), '#').'\?via=share"#');
    });
});

describe('privacy', function () {
    it('stores no address, user agent, member or device, only the hash of the day', function () {
        // SF-2: not even a time of day, only the Berlin day.
        expect(Schema::getColumnListing('view_events'))->toEqualCanonicalizing(['id', 'subject_type', 'subject_id', 'owner_id', 'vehicle_id', 'day', 'source', 'viewer_hash'])
            ->and(Schema::getColumnListing('view_days'))->toEqualCanonicalizing(['id', 'subject_type', 'subject_id', 'owner_id', 'vehicle_id', 'day', 'source', 'views']);

        $viewer = User::factory()->create();
        engVehicleView($viewer, $this->car);
        $row = (array) DB::table('view_events')->sole();

        expect(json_encode($row))->not->toContain($viewer->id)->not->toContain('127.0.0.1')->not->toContain('iPhone')
            ->and($row['viewer_hash'])->toMatch('/\A[0-9a-f]{32}\z/');
    });

    it('keys the hash with a salt of the day that is deleted when the next day starts', function () {
        $viewer = User::factory()->create();
        $other = publishedVehicle(User::factory()->create());

        engVehicleView($viewer, $this->car);
        $first = DB::table('view_events')->value('viewer_hash');
        $firstDay = CarbonImmutable::now('Europe/Berlin')->toDateString();

        $this->travel(1)->day();
        engVehicleView($viewer, $other);

        expect(DB::table('view_events')->where('vehicle_id', $other->id)->value('viewer_hash'))->not->toBe($first)
            ->and(ViewSalt::query()->pluck('day')->map(fn ($day): string => substr((string) $day, 0, 10))->all())->not->toContain($firstDay)
            ->and(ViewSalt::query()->count())->toBe(1);
    });
});
