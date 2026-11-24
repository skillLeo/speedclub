<?php

use App\Actions\Admin\Members\StartViewAs;
use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Enums\PlateBlurState;
use App\Enums\RestrictionType;
use App\Http\RateLimits;
use App\Models\ConfigVersion;
use App\Models\QrCode;
use App\Models\Staff;
use App\Models\User;
use App\Models\Wrapped;
use App\Services\Config\Schemas\RemoteConfigSchema;
use App\Services\Qr\QrCodes;
use App\Services\Wrapped\Season;
use App\Services\Wrapped\WrappedGenerator;
use App\Services\Wrapped\WrappedReleases;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/WrappedTestHelpers.php';
require_once __DIR__.'/../Staff/Helpers.php';

/**
 * M5.9e (m5.9e contract §5, §8): GET me/wrapped, GET me/wrapped/{season_key}, POST …/shared, GET …/cards/{n}.png — release gating,
 * the app's shapes (mobile/src/api/queries/wrapped.ts), the authorisation matrix, rate limit and idempotency, the PNG.
 */
beforeEach(function () {
    wrFlags();
    wrRelease();
    $this->travelTo(wrNow());
    Storage::fake(config()->string('speedclub.media.private_disk'));
    $this->owner = User::factory()->create(['username' => 'wrapped.owner', 'display_name' => 'Wrapped Owner']);
    $this->car = wrCar($this->owner, ['dex_number' => 34]);
    $mod = wrMod($this->car, 'wheels_tires', ['title' => 'Meister S1 3P', 'brand_text' => 'Work']);
    wrPhoto($mod, $this->owner);
    wrMod($this->car, 'suspension');
    wrMod($this->car, 'wheels_tires');
    wrScore($this->car, 642, ['2027-06-01' => 642]);
    $cover = wrPhoto($this->car, $this->owner);
    $this->car->forceFill(['cover_media_id' => $cover->id])->save();
    $this->code = QrCode::factory()->create(['vehicle_id' => $this->car->id]);
    $this->wrapped = app(WrappedGenerator::class)->generate($this->owner, Season::from(WR_SEASON));
});

/** The authorisation matrix (project rules): who asks, and what the owner's Wrapped answers them. */
function wrViewers(): array
{
    return [
        'guest' => [fn () => null, 401],
        'owner' => [fn (User $owner) => $owner, 200],
        'other member' => [fn () => User::factory()->create(), 404],
        'member the owner blocked' => [function (User $owner) {
            $member = User::factory()->create();
            wrBlock($owner, $member);

            return $member;
        }, 404],
        'restricted owner' => [function (User $owner) {
            $owner->forceFill(['restrictions' => [RestrictionType::Publishing->value => ['until' => null]]])->save();

            return $owner->refresh();
        }, 200],
        'staff session' => [fn () => Staff::factory()->create(), 401],
    ];
}

function wrAct(mixed $viewer): void
{
    if ($viewer instanceof User) {
        Sanctum::actingAs($viewer);
    } elseif ($viewer instanceof Staff) {
        test()->actingAs($viewer, 'staff');
    }
}

describe('GET me/wrapped', function () {
    it('lists my seasons newest first, with released and the countdown', function () {
        Wrapped::factory()->season('2026-jahr')->create(['user_id' => $this->owner->id]);
        Wrapped::factory()->season('2027-jahr')->create(['user_id' => $this->owner->id]);
        wrRelease([WR_SEASON => '2027-11-01T10:00:00+01:00', '2027-jahr' => '2027-11-06T10:00:00+01:00']);
        Sanctum::actingAs($this->owner);

        $response = $this->getJson('/api/v1/me/wrapped')->assertOk()->assertHeader('ETag');

        expect(array_column($response->json('data'), 'season_key'))->toBe(['2027-jahr', '2027-saison', '2026-jahr'])
            ->and(array_column($response->json('data'), 'released'))->toBe([false, true, false])
            ->and(array_keys($response->json('data.0')))->toBe(['season_key', 'released', 'generated_at', 'viewed_at'])
            ->and($response->json('meta.countdown'))->toBe(['season_key' => '2027-jahr', 'release_at' => '2027-11-06T10:00:00+01:00']);
    });

    it('shows the countdown only within seven days and while its flag is on', function () {
        Wrapped::factory()->season('2027-jahr')->create(['user_id' => $this->owner->id]);
        Sanctum::actingAs($this->owner);
        wrRelease(['2027-jahr' => '2027-12-20T10:00:00+01:00']);

        expect($this->getJson('/api/v1/me/wrapped')->assertOk()->json('meta.countdown'))->toBeNull();

        wrRelease(['2027-jahr' => '2027-11-08T10:00:00+01:00']);
        wrFlags(['wrapped.countdown' => false]);

        expect($this->getJson('/api/v1/me/wrapped')->assertOk()->json('meta.countdown'))->toBeNull();
    });

    it('answers per viewer', function (Closure $viewer, int $status) {
        wrAct($viewer($this->owner));
        $response = $this->getJson('/api/v1/me/wrapped');

        // A list is always the asker's own: another member sees an empty list, never the owner's seasons.
        $response->assertStatus($status === 404 ? 200 : $status);

        if ($response->status() === 200) {
            expect(array_column($response->json('data'), 'season_key'))->toBe($status === 200 ? [WR_SEASON] : []);
        }
    })->with(wrViewers());

    it('answers 404 feature_disabled while the flag is off', function () {
        wrFlags(['wrapped' => false]);
        $this->getJson('/api/v1/me/wrapped')->assertUnauthorized();
        Sanctum::actingAs($this->owner);
        $this->getJson('/api/v1/me/wrapped')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
        $this->getJson('/api/v1/me/wrapped/'.WR_SEASON)->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    });
});

describe('GET me/wrapped/{season_key}', function () {
    it('answers the app\'s payload in my language and marks it viewed once', function () {
        Sanctum::actingAs($this->owner);

        $data = $this->getJson('/api/v1/me/wrapped/'.WR_SEASON, ['Accept-Language' => 'de'])->assertOk()->json('data');
        $viewed = $this->wrapped->refresh()->viewed_at;

        expect(array_keys($data))->toBe(['v', 'season_key', 'window', 'member', 'cards'])
            ->and($data['member'])->toMatchArray(['display_name' => 'Wrapped Owner', 'username' => 'wrapped.owner'])
            ->and(array_column($data['cards'], 'kind'))->toBe(['intro', 'score', 'top_mod', 'build_spirit', 'share'])
            ->and($data['cards'][0])->toBe(['kind' => 'intro', 'title' => 'Deine Saison 2027', 'subtitle' => __('wrapped.intro.saison.subtitle', [], 'de'), 'image' => $data['cards'][4]['image']])
            ->and($data['cards'][1]['image'])->toBe($data['cards'][4]['image'])
            ->and($data['cards'][3]['image'])->toBe($data['cards'][4]['image'])
            ->and($data['cards'][1])->toMatchArray(['kind' => 'score', 'from' => 0, 'to' => 642, 'stage_from' => 1, 'stage_to' => 4])
            ->and($data['cards'][2]['after_media'])->toHaveKeys(['url', 'variants', 'blurhash', 'thumbhash', 'focal_x', 'focal_y'])
            ->and($data['cards'][2]['before_media'])->toBeNull()
            ->and($data['cards'][3])->toMatchArray(['kind' => 'build_spirit', 'key' => 'shakotan_artist', 'title' => 'Shakotan Artist'])
            ->and($data['cards'][3]['explanation'])->toContain('100 %')
            ->and($data['cards'][4])->toMatchArray(['kind' => 'share', 'dex_number' => 34, 'score' => 642, 'qr_url' => app(QrCodes::class)->pageUrl($this->car->fresh())])
            ->and($data['cards'][4]['image']['url'])->toBeString()
            ->and($viewed)->not->toBeNull();

        $this->travel(1)->hours();
        $en = $this->getJson('/api/v1/me/wrapped/'.WR_SEASON, ['Accept-Language' => 'en'])->assertOk()->json('data');

        expect($en['cards'][0]['title'])->toBe('Your 2027 season')
            ->and($en['cards'][3]['explanation'])->toContain('100%')
            ->and($this->wrapped->refresh()->viewed_at?->equalTo($viewed))->toBeTrue();
    });

    it('lets staff in view-as read it without marking it viewed (SEC-P5-11)', function () {
        $token = app(StartViewAs::class)->handle(m31Staff('admin'), $this->owner, 'Ticket 4711: Wrapped lädt nicht, geprüft.', false)['token'];

        $this->withToken($token)->getJson('/api/v1/me/wrapped/'.WR_SEASON)->assertOk()->assertJsonPath('data.season_key', WR_SEASON);
        expect($this->wrapped->refresh()->viewed_at)->toBeNull();

        $this->app['auth']->forgetGuards();
        $this->withToken($this->owner->createToken('phone', ['member'])->plainTextToken)->getJson('/api/v1/me/wrapped/'.WR_SEASON)->assertOk();
        expect($this->wrapped->refresh()->viewed_at)->not->toBeNull();
    });

    it('reads photos and the car\'s reachability again on every request', function () {
        Sanctum::actingAs($this->owner);
        // ADR-514: the QR is the car's page, so it goes with the page (private), not with the sticker.
        $this->car->forceFill(['visibility' => 'private'])->save();
        $this->car->cover?->forceFill(['plate_blur' => PlateBlurState::Unchecked])->save();

        $share = collect($this->getJson('/api/v1/me/wrapped/'.WR_SEASON)->assertOk()->json('data.cards'))->firstWhere('kind', 'share');

        expect($share['qr_url'])->toBeNull()->and($share['image'])->toBeNull();
    });

    it('is closed before the release, then 404 without a Wrapped', function () {
        Sanctum::actingAs($this->owner);
        wrRelease([WR_SEASON => '2027-11-05T10:00:00+01:00']);

        $this->getJson('/api/v1/me/wrapped/'.WR_SEASON)->assertForbidden()->assertJsonPath('code', 'wrapped_not_released');
        // Without a row and without a release: still "not yet", nothing leaks either way.
        $this->getJson('/api/v1/me/wrapped/2027-jahr')->assertForbidden()->assertJsonPath('code', 'wrapped_not_released');
        expect($this->wrapped->refresh()->viewed_at)->toBeNull();

        $this->travelTo(wrIn('2027-11-05 10:00:00'));
        $this->getJson('/api/v1/me/wrapped/'.WR_SEASON)->assertOk();

        wrRelease([WR_SEASON => '2027-11-01T10:00:00+01:00', '2026-saison' => '2026-11-01T10:00:00+01:00']);
        $this->getJson('/api/v1/me/wrapped/2026-saison')->assertNotFound()->assertJsonPath('code', 'not_found');
        $this->getJson('/api/v1/me/wrapped/2027-winter')->assertStatus(422)->assertJsonValidationErrors('season_key');
    });

    it('takes the release from the published remote config over the defaults', function () {
        Sanctum::actingAs($this->owner);
        wrRelease([]);
        $this->getJson('/api/v1/me/wrapped/'.WR_SEASON)->assertForbidden();

        ConfigVersion::factory()->create([
            'key' => ConfigKey::RemoteConfig->value,
            'status' => ConfigVersionStatus::Published,
            'payload' => [...app(RemoteConfigSchema::class)->initial(), 'wrapped' => ['releases' => [WR_SEASON => '2027-11-01T10:00:00+01:00']]],
        ]);
        app()->forgetInstance(WrappedReleases::class);

        $this->getJson('/api/v1/me/wrapped/'.WR_SEASON)->assertOk();
    });

    it('opens the staging demo of a sample member early, never in production', function () {
        wrRelease([]);
        $this->wrapped->forceFill(['is_sample' => true])->save();
        Sanctum::actingAs($this->owner);

        $this->getJson('/api/v1/me/wrapped/'.WR_SEASON)->assertOk()->assertJsonPath('data.is_sample', true);

        app()->detectEnvironment(fn () => 'production');

        try {
            $this->getJson('/api/v1/me/wrapped/'.WR_SEASON)->assertForbidden();
            wrRelease();
            $this->getJson('/api/v1/me/wrapped/'.WR_SEASON)->assertNotFound();
        } finally {
            app()->detectEnvironment(fn () => 'testing');
        }
    });

    it('answers per viewer', function (Closure $viewer, int $status) {
        wrAct($viewer($this->owner));

        $this->getJson('/api/v1/me/wrapped/'.WR_SEASON)->assertStatus($status);
    })->with(wrViewers());
});

describe('POST me/wrapped/{season_key}/shared', function () {
    it('counts a share once per Idempotency-Key', function () {
        Sanctum::actingAs($this->owner);
        $headers = ['Idempotency-Key' => 'share-1'];

        $this->postJson('/api/v1/me/wrapped/'.WR_SEASON.'/shared', [], $headers)->assertOk()->assertJsonPath('data', ['season_key' => WR_SEASON, 'shared_count' => 1]);
        $this->postJson('/api/v1/me/wrapped/'.WR_SEASON.'/shared', [], $headers)->assertOk()->assertJsonPath('data.shared_count', 1);
        $this->postJson('/api/v1/me/wrapped/'.WR_SEASON.'/shared', [], ['Idempotency-Key' => 'share-2'])->assertOk()->assertJsonPath('data.shared_count', 2);

        expect($this->wrapped->refresh()->shared_count)->toBe(2);
    });

    it('is limited per member', function () {
        config(['speedclub.rate_limits.wrapped.max' => 2]);
        RateLimits::register();
        Sanctum::actingAs($this->owner);

        $this->postJson('/api/v1/me/wrapped/'.WR_SEASON.'/shared')->assertOk();
        $this->postJson('/api/v1/me/wrapped/'.WR_SEASON.'/shared')->assertOk();
        $this->postJson('/api/v1/me/wrapped/'.WR_SEASON.'/shared')->assertStatus(429)->assertJsonPath('code', 'rate_limited');
    });

    it('is closed before the release', function () {
        wrRelease([WR_SEASON => '2027-11-05T10:00:00+01:00']);
        Sanctum::actingAs($this->owner);

        $this->postJson('/api/v1/me/wrapped/'.WR_SEASON.'/shared')->assertForbidden()->assertJsonPath('code', 'wrapped_not_released');
        expect($this->wrapped->refresh()->shared_count)->toBe(0);
    });

    it('answers per viewer; a member restricted from publishing does not share', function (Closure $viewer, int $status) {
        $member = $viewer($this->owner);
        wrAct($member);
        $restricted = $member instanceof User && $member->isRestrictedFrom(RestrictionType::Publishing);

        $response = $this->postJson('/api/v1/me/wrapped/'.WR_SEASON.'/shared');

        if ($restricted) {
            $response->assertForbidden()->assertJsonPath('code', 'account_restricted');
        } else {
            $response->assertStatus($status);
        }

        expect($this->wrapped->refresh()->shared_count)->toBe($status === 200 && ! $restricted ? 1 : 0);
    })->with(wrViewers());
});

describe('GET me/wrapped/{season_key}/cards/{n}.png', function () {
    it('draws card n as a 1080 × 1920 PNG, cached by its content', function () {
        Sanctum::actingAs($this->owner);

        foreach (range(1, count($this->wrapped->cards())) as $n) {
            $response = $this->get('/api/v1/me/wrapped/'.WR_SEASON."/cards/$n.png")->assertOk()->assertHeader('Content-Type', 'image/png');
            $size = getimagesizefromstring((string) $response->getContent());

            expect([$size[0], $size[1]])->toBe([1080, 1920])
                ->and($response->headers->get('Cache-Control'))->toContain('private');
        }

        $etag = (string) $this->get('/api/v1/me/wrapped/'.WR_SEASON.'/cards/1.png')->headers->get('ETag');
        $this->get('/api/v1/me/wrapped/'.WR_SEASON.'/cards/1.png', ['If-None-Match' => $etag])->assertStatus(304);
        expect(Storage::disk(config()->string('speedclub.media.private_disk'))->allFiles('wrapped'))->toHaveCount(count($this->wrapped->cards()));
    });

    it('answers 404 for a position without a card and refuses before the release', function () {
        Sanctum::actingAs($this->owner);

        $this->get('/api/v1/me/wrapped/'.WR_SEASON.'/cards/9.png')->assertNotFound();
        $this->get('/api/v1/me/wrapped/'.WR_SEASON.'/cards/0.png')->assertStatus(422);
        $this->getJson('/api/v1/me/wrapped/'.WR_SEASON.'/cards/x.png')->assertStatus(422)->assertJsonValidationErrors('n');

        wrRelease([WR_SEASON => '2027-11-05T10:00:00+01:00']);
        $this->getJson('/api/v1/me/wrapped/'.WR_SEASON.'/cards/1.png')->assertForbidden()->assertJsonPath('code', 'wrapped_not_released');
    });

    it('answers per viewer', function (Closure $viewer, int $status) {
        wrAct($viewer($this->owner));

        $this->getJson('/api/v1/me/wrapped/'.WR_SEASON.'/cards/1.png')->assertStatus($status);
    })->with(wrViewers());
});

describe('remote config wrapped.releases', function () {
    it('keeps valid releases normalised and refuses a broken one', function () {
        $this->travelTo(wrIn('2027-10-01 12:00:00'));
        $schema = app(RemoteConfigSchema::class);
        $base = $schema->initial();

        expect($schema->normalize($base))->not->toHaveKey('wrapped')
            ->and($schema->normalize([...$base, 'wrapped' => ['releases' => ['2027-jahr' => '2028-01-05T10:00:00+01:00', WR_SEASON => '2027-11-01T09:00:00Z']]])['wrapped'])
            ->toBe(['releases' => ['2027-jahr' => '2028-01-05T10:00:00+01:00', WR_SEASON => '2027-11-01T09:00:00+00:00']]);

        // CR-P5G-06: before the season's end, or less than a day ahead.
        foreach ([['2027-jahr' => '2027-12-20T10:00:00+01:00'], [WR_SEASON => '2027-10-01T18:00:00+02:00']] as $releases) {
            expect(fn () => $schema->normalize([...$base, 'wrapped' => ['releases' => $releases]]))->toThrow(ValidationException::class);
        }

        foreach ([['2027-winter' => '2027-11-01T10:00:00+01:00'], [WR_SEASON => 'morgen'], [WR_SEASON => '2027-11-01']] as $releases) {
            expect(fn () => $schema->normalize([...$base, 'wrapped' => ['releases' => $releases]]))->toThrow(ValidationException::class);
        }
    });
});
