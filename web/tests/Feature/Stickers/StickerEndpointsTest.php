<?php

use App\Enums\KeywordList;
use App\Enums\QrRevocationReason;
use App\Enums\QrStatus;
use App\Enums\RestrictionType;
use App\Enums\StickerColourway;
use App\Enums\StickerScanTest;
use App\Enums\StickerTemplate;
use App\Http\RateLimits;
use App\Models\Block;
use App\Models\FeatureFlag;
use App\Models\KeywordRule;
use App\Models\QrScanDaily;
use App\Models\Staff;
use App\Models\StickerDesign;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\AppConfig\AppConfig;
use App\Services\Qr\QrCodes;
use App\Services\Rules\KeywordNormaliser;
use App\Services\Rules\KeywordRules;
use App\Services\Stickers\StickerOptions;
use App\Services\Stickers\StickerOrderLink;
use App\Services\Stickers\StickerScanner;
use Carbon\CarbonImmutable;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\Schema;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/StickerTestHelpers.php';

/**
 * M5.4 member API (m5.4-contract §3–§7): STK-01 hub, STK-04 stats, STK-05 designer (templates, autosave, preview, Scan-Test),
 * STK-07 versions, the files of a version and the STK-06 order link. Owner only; the matrix follows the QR routes (SEC-P1-10).
 */
beforeEach(function () {
    $this->owner = User::factory()->create(['username' => 'lukas.sc']);
    [$this->vehicle, $this->qr] = stkCar($this->owner);
    $this->design = StickerDesign::factory()->validated($this->qr->id)->create(['vehicle_id' => $this->vehicle->id]);
    stkStatsFlag();
});

/**
 * @return array<string, array{0: string, 1: string, 2: bool}> method, path (relative to the vehicle or the design), writes
 */
function stkVehicleRoutes(): array
{
    return [
        'stats' => ['get', '/sticker/stats', false],
        'design' => ['get', '/sticker-design', false],
        'autosave' => ['put', '/sticker-design', true],
        'preview' => ['post', '/sticker-design/preview', true],
        'scan test' => ['post', '/sticker-design/validate', true],
        'versions' => ['get', '/sticker-design/versions', false],
        'restore' => ['post', '/sticker-design/versions/1/restore', true],
    ];
}

/**
 * @return array<string, array{0: string, 1: string, 2: bool}>
 */
function stkDesignRoutes(): array
{
    return [
        'preview.svg' => ['get', '/preview.svg', false],
        'share.png' => ['get', '/share.png', false],
        'print.svg' => ['get', '/print.svg', false],
        'print.pdf' => ['get', '/print.pdf', false],
        'print.png' => ['get', '/print.png', false],
        'order link' => ['post', '/order-link', true],
    ];
}

function stkCall(string $method, string $url): mixed
{
    $body = match (true) {
        str_ends_with($url, '/sticker-design') => stkDesignBody(1, 'minimal', ['size' => 's']),
        str_ends_with($url, '/preview') => ['template' => 'round', 'options' => []],
        str_ends_with($url, '/validate') => ['version' => 1],
        str_ends_with($url, '/restore') => ['base_revision' => 0],
        default => [],
    };

    return match ($method) {
        'put' => test()->putJson($url, $body),
        'post' => test()->postJson($url, $body),
        default => test()->get($url, ['Accept' => 'application/json']),
    };
}

/**
 * @return array<string, array{0: Closure, 1: int}>
 */
function stkMatrix(): array
{
    return [
        'guest' => [fn (User $owner): ?User => null, 401],
        'owner' => [fn (User $owner): ?User => $owner, 200],
        'other member' => [fn (User $owner): ?User => User::factory()->create(), 403],
        'member the owner blocked' => [function (User $owner): ?User {
            $member = User::factory()->create();
            Block::factory()->create(['blocker_id' => $owner->id, 'blocked_id' => $member->id]);

            return $member;
        }, 404],
        'member who blocked the owner' => [function (User $owner): ?User {
            $member = User::factory()->create();
            Block::factory()->create(['blocker_id' => $member->id, 'blocked_id' => $owner->id]);

            return $member;
        }, 404],
    ];
}

describe('authorisation matrix', function () {
    it('lets only the owner use the vehicle routes', function (string $method, string $suffix, bool $writes, Closure $who, int $status) {
        $viewer = $who($this->owner);

        if ($viewer !== null) {
            Sanctum::actingAs($viewer);
        }

        // The scan test needs a draft as the current version.
        if ($suffix === '/sticker-design/validate') {
            $this->design->forceFill(['validated_at' => null, 'scan_test' => null])->save();
        }

        $response = stkCall($method, '/api/v1/vehicles/'.$this->vehicle->id.$suffix);

        // The owner's autosave opens version 2 here: 201.
        $status === 200 ? $response->assertSuccessful() : $response->assertStatus($status);
    })->with(stkVehicleRoutes())->with(stkMatrix());

    it('lets only the owner use the files and the order link of a version', function (string $method, string $suffix, bool $writes, Closure $who, int $status) {
        $viewer = $who($this->owner);

        if ($viewer !== null) {
            Sanctum::actingAs($viewer);
        }

        stkCall($method, '/api/v1/sticker-designs/'.$this->design->id.$suffix)->assertStatus($status);
    })->with(stkDesignRoutes())->with(stkMatrix());

    it('answers 401 to a staff session on every route', function (string $method, string $suffix) {
        $this->actingAs(Staff::factory()->create(), 'staff');

        stkCall($method, '/api/v1/vehicles/'.$this->vehicle->id.$suffix)->assertUnauthorized();
        $this->getJson('/api/v1/me/stickers')->assertUnauthorized();
    })->with(array_map(fn (array $r): array => [$r[0], $r[1]], stkVehicleRoutes()));

    it('keeps everything open under a publishing restriction', function (string $method, string $suffix) {
        $member = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
        [$vehicle, $qr] = stkCar($member);
        StickerDesign::factory()->create(['vehicle_id' => $vehicle->id]);
        Sanctum::actingAs($member);

        stkCall($method, '/api/v1/vehicles/'.$vehicle->id.$suffix)->assertOk();
    })->with(array_map(fn (array $r): array => [$r[0], $r[1]], stkVehicleRoutes()));

    it('lets a suspended owner read and download but not change anything', function () {
        $member = User::factory()->suspended()->create();
        [$vehicle, $qr] = stkCar($member);
        $design = StickerDesign::factory()->validated($qr->id)->create(['vehicle_id' => $vehicle->id]);
        Sanctum::actingAs($member);

        foreach (stkVehicleRoutes() as [$method, $suffix, $writes]) {
            stkCall($method, '/api/v1/vehicles/'.$vehicle->id.$suffix)->assertStatus($writes ? 403 : 200);
        }

        foreach (stkDesignRoutes() as [$method, $suffix, $writes]) {
            stkCall($method, '/api/v1/sticker-designs/'.$design->id.$suffix)->assertStatus($writes ? 403 : 200);
        }

        $this->getJson('/api/v1/me/stickers')->assertOk()->assertJsonPath('data.0.actions.design', false);
    });

    it('answers 404 for a draft car, which has no sticker yet', function () {
        $draft = Vehicle::factory()->create(['owner_id' => $this->owner->id]);
        Sanctum::actingAs($this->owner);

        $this->getJson('/api/v1/vehicles/'.$draft->id.'/sticker-design')->assertNotFound();
        $this->putJson('/api/v1/vehicles/'.$draft->id.'/sticker-design', stkDesignBody())->assertNotFound();
    });

    it('answers 401 to a guest on the hub and the templates', function () {
        $this->getJson('/api/v1/me/stickers')->assertUnauthorized();
        $this->getJson('/api/v1/stickers/templates')->assertUnauthorized();
    });
});

describe('GET stickers/templates', function () {
    it('lists six templates with sizes in mm, a code of at least 25 mm everywhere, the colourways and the limits', function () {
        Sanctum::actingAs($this->owner);

        $response = $this->getJson('/api/v1/stickers/templates')->assertOk()
            ->assertJsonCount(6, 'data.templates')
            ->assertJsonPath('data.templates.0.key', 'classic')
            ->assertJsonPath('data.templates.0.sizes.1.key', 'm')
            ->assertJsonPath('data.templates.0.sizes.1.width_mm', 156)
            ->assertJsonPath('data.templates.0.sizes.1.height_mm', 65)
            ->assertJsonPath('data.templates.5.shape', 'circle')
            ->assertJsonPath('data.templates.2.defaults.qr', false)
            ->assertJsonPath('data.colourways.0.materials', ['transparent'])
            ->assertJsonPath('data.colourways.1.materials', ['transparent', 'white_vinyl'])
            ->assertJsonPath('data.limits', ['custom_line_max' => 24, 'qr_min_mm' => 25, 'quiet_zone_modules' => 4, 'error_correction' => 'H', 'bleed_mm' => 3]);

        foreach ($response->json('data.templates') as $template) {
            foreach ($template['sizes'] as $size) {
                expect($size['qr_mm'])->toBeGreaterThanOrEqual(25.0);
            }
        }

        expect($response->headers->get('ETag'))->not->toBeNull();
    });

    it('speaks English on request', function () {
        Sanctum::actingAs($this->owner);

        $this->getJson('/api/v1/stickers/templates', ['Accept-Language' => 'en'])->assertOk()
            ->assertJsonPath('data.colourways.0.name', 'White print')
            ->assertJsonPath('data.colourways.0.hint', 'For dark glass');
    });
});

describe('GET me/stickers', function () {
    it('shows one card per published car with status, scans since Monday, the design and the actions', function () {
        $this->travelTo(CarbonImmutable::parse('2026-11-18 12:00', 'Europe/Berlin')); // a Wednesday
        QrScanDaily::query()->create(['qr_code_id' => $this->qr->id, 'day' => '2026-11-16', 'count' => 3]);
        QrScanDaily::query()->create(['qr_code_id' => $this->qr->id, 'day' => '2026-11-18', 'count' => 2]);
        QrScanDaily::query()->create(['qr_code_id' => $this->qr->id, 'day' => '2026-11-15', 'count' => 9]); // last Sunday
        [$second] = stkCar($this->owner);
        Vehicle::factory()->create(['owner_id' => $this->owner->id]); // a draft has no card
        stkCar(); // somebody else's
        Sanctum::actingAs($this->owner);

        $response = $this->getJson('/api/v1/me/stickers')->assertOk()->assertJsonCount(2, 'data');
        $card = collect($response->json('data'))->firstWhere('vehicle.id', $this->vehicle->id);
        $empty = collect($response->json('data'))->firstWhere('vehicle.id', $second->id);

        expect($card['sticker']['status'])->toBe('active')
            ->and($card['scans_this_week'])->toBe(5)
            ->and($card['design']['reference'])->toBe($this->design->reference)
            ->and($card['design']['state'])->toBe('validated')
            ->and($card['actions'])->toBe(['design' => true, 'order' => ['available' => false, 'reason' => 'not_configured'], 'download' => true])
            ->and($empty['design'])->toBeNull()
            ->and($empty['scans_this_week'])->toBe(0)
            ->and($empty['actions']['order'])->toBe(['available' => false, 'reason' => 'no_design']);
    });

    it('shows a sticker staff took down as gesperrt, with nothing to order or download', function () {
        app(QrCodes::class)->revoke($this->vehicle, QrRevocationReason::Moderation);
        Sanctum::actingAs($this->owner);

        $this->getJson('/api/v1/me/stickers')->assertOk()
            ->assertJsonPath('data.0.sticker.status', 'revoked')
            ->assertJsonPath('data.0.actions.order.reason', 'code_replaced')
            ->assertJsonPath('data.0.actions.download', false);
    });
});

describe('GET vehicles/{id}/sticker/stats', function () {
    it('gives 30 days, the weeks, the first scan and the sources, over every code the car had', function () {
        $this->travelTo(CarbonImmutable::parse('2026-11-18 12:00', 'Europe/Berlin'));
        QrScanDaily::query()->create(['qr_code_id' => $this->qr->id, 'day' => '2026-11-17', 'count' => 4]);
        QrScanDaily::query()->create(['qr_code_id' => $this->qr->id, 'day' => '2026-11-10', 'count' => 6]);
        $old = $this->vehicle->qrCodes()->create(['code' => 'ZZZZ0000']);
        $old->forceFill(['status' => QrStatus::Revoked])->save();
        QrScanDaily::query()->create(['qr_code_id' => $old->id, 'day' => '2026-01-02', 'count' => 7]);
        Sanctum::actingAs($this->owner);

        $response = $this->getJson('/api/v1/vehicles/'.$this->vehicle->id.'/sticker/stats')->assertOk()
            ->assertJsonCount(30, 'data.days')
            ->assertJsonPath('data.total', 17)
            ->assertJsonPath('data.total_30_days', 10)
            ->assertJsonPath('data.this_week', 4)
            ->assertJsonPath('data.last_week', 6)
            ->assertJsonPath('data.first_scan_on', '2026-01-02')
            ->assertJsonPath('data.sources', ['sticker_scan' => 10, 'link' => null])
            ->assertJsonPath('data.milestones_reached', [10]);

        expect($response->json('data.days.29'))->toBe(['date' => '2026-11-18', 'count' => 0]);
    });

    it('holds no trace of who scanned: no viewer, address, device, browser or place anywhere', function () {
        QrScanDaily::query()->create(['qr_code_id' => $this->qr->id, 'day' => now('Europe/Berlin')->toDateString(), 'count' => 3]);
        Sanctum::actingAs($this->owner);

        $json = (string) $this->getJson('/api/v1/vehicles/'.$this->vehicle->id.'/sticker/stats')->assertOk()->getContent();
        $keys = array_keys(Arr::dot(json_decode($json, true)));

        foreach (['user', 'viewer', 'ip', 'agent', 'device', 'browser', 'location', 'city', 'lat', 'lng', 'country', 'username', 'email'] as $word) {
            expect(collect($keys)->filter(fn (string $key): bool => preg_match('/(^|[._])'.$word.'([._]|$)/', $key) === 1)->all())->toBe([]);
        }

        expect(Schema::getColumnListing('qr_scan_daily'))->toEqualCanonicalizing(['id', 'qr_code_id', 'day', 'count'])
            ->and(Schema::getColumnListing('sticker_designs'))->not->toContain('ip')->not->toContain('user_agent');
    });

    it('answers 404 feature_disabled while sig.qr_stats is off', function () {
        FeatureFlag::query()->where('key', 'sig.qr_stats')->update(['enabled' => false]);
        app(AppConfig::class)->flush();
        Sanctum::actingAs($this->owner);

        $this->getJson('/api/v1/vehicles/'.$this->vehicle->id.'/sticker/stats')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    });
});

describe('the designer: show, autosave, versions', function () {
    it('starts from an unsaved default before the first save', function () {
        [$fresh] = stkCar($this->owner);
        Sanctum::actingAs($this->owner);

        $this->getJson('/api/v1/vehicles/'.$fresh->id.'/sticker-design')->assertOk()
            ->assertJsonPath('data.persisted', false)
            ->assertJsonPath('data.id', null)
            ->assertJsonPath('data.version', 0)
            ->assertJsonPath('data.revision', 0)
            ->assertJsonPath('data.template', 'classic')
            ->assertJsonPath('data.options.qr', true)
            ->assertJsonPath('data.options.username', true)
            ->assertJsonPath('data.urls.print_pdf', null);
    });

    it('creates version 1, then updates the draft in place, and opens version 2 after a passed Scan-Test', function () {
        [$fresh] = stkCar($this->owner);
        Sanctum::actingAs($this->owner);
        $url = '/api/v1/vehicles/'.$fresh->id.'/sticker-design';

        $this->putJson($url, stkDesignBody(0, 'plate', ['custom_line' => '  Built not bought  ']))->assertCreated()
            ->assertJsonPath('data.version', 1)
            ->assertJsonPath('data.revision', 1)
            ->assertJsonPath('data.state', 'draft')
            ->assertJsonPath('data.options.custom_line', 'Built not bought')
            ->assertJsonPath('data.effective', ['username' => true, 'car_name' => false, 'custom_line' => true]);
        $this->putJson($url, stkDesignBody(1, 'plate', ['size' => 'l'], 1))->assertOk()->assertJsonPath('data.version', 1)->assertJsonPath('data.revision', 2)
            ->assertJsonPath('data.options.size', 'l')
            ->assertJsonPath('data.options.custom_line', 'Built not bought');

        expect(StickerDesign::query()->where('vehicle_id', $fresh->id)->count())->toBe(1);

        $this->postJson($url.'/validate', ['version' => 1, 'client_scan_test' => 'passed'])->assertOk()
            ->assertJsonPath('data.state', 'validated')
            ->assertJsonPath('data.scan_test', 'passed');
        $this->putJson($url, stkDesignBody(1, 'plate', ['colourway' => 'black'], 2))->assertCreated()->assertJsonPath('data.version', 2)->assertJsonPath('data.revision', 3)
            ->assertJsonPath('data.state', 'draft');

        $versions = $this->getJson($url.'/versions')->assertOk()->assertJsonCount(2, 'data');
        expect($versions->json('data.0.version'))->toBe(2)
            ->and($versions->json('data.1.options.colourway'))->toBe('white')
            ->and($versions->json('data.0.reference'))->not->toBe($versions->json('data.1.reference'));
    });

    it('writes nothing for the same content', function () {
        Sanctum::actingAs($this->owner);
        $before = $this->design->updated_at;
        $this->travel(5)->minutes();

        $this->putJson('/api/v1/vehicles/'.$this->vehicle->id.'/sticker-design', stkDesignBody(1, 'classic', []))->assertOk()->assertJsonPath('data.version', 1)
            ->assertJsonPath('data.revision', 0);

        expect($this->design->fresh()->updated_at->equalTo($before))->toBeTrue()
            ->and(StickerDesign::query()->count())->toBe(1);
    });

    it('answers 409 edit_conflict when another device saved in between', function () {
        Sanctum::actingAs($this->owner);

        $this->putJson('/api/v1/vehicles/'.$this->vehicle->id.'/sticker-design', stkDesignBody(0))->assertStatus(409)
            ->assertJsonPath('code', 'edit_conflict')
            ->assertJsonPath('current_version', 1)
            ->assertJsonPath('current_revision', 0);
    });

    it('answers 409 edit_conflict when another device saved the same draft in place (review MF-4)', function () {
        $this->design->forceFill(['validated_at' => null, 'scan_test' => null, 'qr_code_id' => null])->save();
        Sanctum::actingAs($this->owner);
        $url = '/api/v1/vehicles/'.$this->vehicle->id.'/sticker-design';

        // Device B and device A both hold draft v1 at revision 0. B saves first.
        $this->putJson($url, stkDesignBody(1, 'classic', ['custom_line' => 'Built not bought'], 0))->assertOk()
            ->assertJsonPath('data.version', 1)
            ->assertJsonPath('data.revision', 1);

        // A saves with the same base: the version still matches, the revision does not.
        $this->putJson($url, stkDesignBody(1, 'classic', ['size' => 'l'], 0))->assertStatus(409)
            ->assertJsonPath('code', 'edit_conflict')
            ->assertJsonPath('current_version', 1)
            ->assertJsonPath('current_revision', 1);

        $design = $this->design->fresh();
        expect($design->revision)->toBe(1)
            ->and($design->options['custom_line'])->toBe('Built not bought')
            ->and($design->options['size'])->toBe('m');

        // After reloading, A's save with the current revision goes through and raises it.
        $this->putJson($url, stkDesignBody(1, 'classic', ['size' => 'l'], 1))->assertOk()
            ->assertJsonPath('data.revision', 2)
            ->assertJsonPath('data.options.size', 'l')
            ->assertJsonPath('data.options.custom_line', 'Built not bought');
        expect(StickerDesign::query()->where('vehicle_id', $this->vehicle->id)->count())->toBe(1);
    });

    it('answers 409 for a revision from the future too', function () {
        Sanctum::actingAs($this->owner);

        $this->putJson('/api/v1/vehicles/'.$this->vehicle->id.'/sticker-design', stkDesignBody(1, 'classic', ['size' => 'l'], 7))->assertStatus(409)
            ->assertJsonPath('code', 'edit_conflict')
            ->assertJsonPath('current_revision', 0);

        expect(StickerDesign::query()->count())->toBe(1);
    });

    it('keeps choices a template does not show and says what it prints', function () {
        Sanctum::actingAs($this->owner);
        $url = '/api/v1/vehicles/'.$this->vehicle->id.'/sticker-design';

        $this->putJson($url, stkDesignBody(1, 'classic', ['car_name' => true, 'custom_line' => 'Kaido']))->assertCreated()->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.revision', 1);
        $this->putJson($url, stkDesignBody(2, 'round', [], 1))->assertOk()
            ->assertJsonPath('data.options.car_name', true)
            ->assertJsonPath('data.options.custom_line', 'Kaido')
            ->assertJsonPath('data.effective', ['username' => true, 'car_name' => false, 'custom_line' => false]);
        $this->putJson($url, stkDesignBody(2, 'classic', [], 2))->assertOk()
            ->assertJsonPath('data.effective', ['username' => true, 'car_name' => true, 'custom_line' => true]);
    });

    it('restores an older version as the next draft', function () {
        Sanctum::actingAs($this->owner);
        $url = '/api/v1/vehicles/'.$this->vehicle->id.'/sticker-design';
        $this->putJson($url, stkDesignBody(1, 'banner', ['qr' => false]))->assertCreated()->assertJsonPath('data.version', 2)->assertJsonPath('data.revision', 1);

        $this->postJson($url.'/versions/1/restore', ['base_revision' => 1])->assertOk()
            ->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.revision', 2)
            ->assertJsonPath('data.template', 'classic')
            ->assertJsonPath('data.options.qr', true);
        $this->postJson($url.'/versions/9/restore', ['base_revision' => 2])->assertNotFound();
    });

    it('restores onto a validated version as a new version with a higher revision', function () {
        StickerDesign::factory()->validated($this->qr->id)->create([
            'vehicle_id' => $this->vehicle->id, 'version' => 2, 'revision' => 4, 'template' => StickerTemplate::Banner,
            'options' => StickerOptions::defaults(StickerTemplate::Banner)->toArray(),
        ]);
        Sanctum::actingAs($this->owner);
        $url = '/api/v1/vehicles/'.$this->vehicle->id.'/sticker-design';

        $this->postJson($url.'/versions/1/restore', ['base_revision' => 3])->assertStatus(409)->assertJsonPath('current_revision', 4);
        $this->postJson($url.'/versions/1/restore', ['base_revision' => 4])->assertCreated()
            ->assertJsonPath('data.version', 3)
            ->assertJsonPath('data.revision', 5)
            ->assertJsonPath('data.template', 'classic')
            ->assertJsonPath('data.state', 'draft');
    });

    it('answers 409 edit_conflict to a restore with a stale revision (review MF-4)', function () {
        Sanctum::actingAs($this->owner);
        $url = '/api/v1/vehicles/'.$this->vehicle->id.'/sticker-design';
        $this->putJson($url, stkDesignBody(1, 'banner', ['qr' => false]))->assertCreated()->assertJsonPath('data.revision', 1);
        // Another device changes the draft v2 in place.
        $this->putJson($url, stkDesignBody(2, 'banner', ['size' => 'l'], 1))->assertOk()->assertJsonPath('data.revision', 2);

        $this->postJson($url.'/versions/1/restore', ['base_revision' => 1])->assertStatus(409)
            ->assertJsonPath('code', 'edit_conflict')
            ->assertJsonPath('current_version', 2)
            ->assertJsonPath('current_revision', 2);

        $current = StickerDesign::query()->where('vehicle_id', $this->vehicle->id)->where('version', 2)->firstOrFail();
        expect($current->template->value)->toBe('banner')
            ->and($current->revision)->toBe(2);
    });

    it('validates the base revision of a restore, in German and English', function (mixed $revision) {
        Sanctum::actingAs($this->owner);
        $url = '/api/v1/vehicles/'.$this->vehicle->id.'/sticker-design/versions/1/restore';
        $body = $revision === 'missing' ? [] : ['base_revision' => $revision];

        $this->postJson($url, $body, ['Accept-Language' => 'de'])->assertUnprocessable()
            ->assertJsonPath('errors.base_revision.0', 'Lade den Sticker neu und versuch es noch einmal.');
        $this->postJson($url, $body, ['Accept-Language' => 'en'])->assertUnprocessable()
            ->assertJsonPath('errors.base_revision.0', 'Reload the sticker and try again.');
    })->with(['missing' => 'missing', 'negative' => -1, 'a string' => 'abc', 'a fraction' => 1.5]);

    it('validates every option and the custom line', function (array $options, string $field) {
        Sanctum::actingAs($this->owner);

        $this->putJson('/api/v1/vehicles/'.$this->vehicle->id.'/sticker-design', stkDesignBody(1, 'classic', $options))
            ->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        'custom line of 25' => [['custom_line' => str_repeat('a', 25)], 'options.custom_line'],
        'custom line on two lines' => [['custom_line' => "Built\nnot bought"], 'options.custom_line'],
        'custom line with a tab' => [['custom_line' => "Built\tnot"], 'options.custom_line'],
        'custom line the font cannot print' => [['custom_line' => 'スピード'], 'options.custom_line'],
        'unknown size' => [['size' => 'xl'], 'options.size'],
        'unknown colourway' => [['colourway' => 'gold'], 'options.colourway'],
        'unknown material' => [['material' => 'chrome'], 'options.material'],
        'qr as a string' => [['qr' => 'yes'], 'options.qr'],
        'mirrored as 1' => [['mirrored' => 1], 'options.mirrored'],
        'unknown option' => [['font' => 'Comic'], 'options'],
        'white on white vinyl' => [['colourway' => 'white', 'material' => 'white_vinyl'], 'options.material'],
        'white and red on white vinyl' => [['colourway' => 'white_red', 'material' => 'white_vinyl'], 'options.material'],
        'mirrored on white vinyl' => [['colourway' => 'black', 'material' => 'white_vinyl', 'mirrored' => true], 'options.mirrored'],
    ]);

    it('takes a custom line of exactly 24 characters, umlauts included', function () {
        Sanctum::actingAs($this->owner);

        $this->putJson('/api/v1/vehicles/'.$this->vehicle->id.'/sticker-design', stkDesignBody(1, 'classic', ['custom_line' => 'Öhlins & Brembo – Saison']))
            ->assertCreated()->assertJsonPath('data.options.custom_line', 'Öhlins & Brembo – Saison');
    });

    it('validates the template and the base version', function () {
        Sanctum::actingAs($this->owner);
        $url = '/api/v1/vehicles/'.$this->vehicle->id.'/sticker-design';

        $this->putJson($url, ['template' => 'hologram', 'options' => []])->assertUnprocessable()->assertJsonValidationErrors(['template', 'base_version', 'base_revision']);
        $this->putJson($url, ['base_version' => -1, 'base_revision' => -1, 'template' => 'classic'])->assertUnprocessable()->assertJsonValidationErrors(['base_version', 'base_revision', 'options']);
    });

    it('validates the base revision of an autosave, in German and English (review MF-4)', function (mixed $revision) {
        Sanctum::actingAs($this->owner);
        $url = '/api/v1/vehicles/'.$this->vehicle->id.'/sticker-design';
        $body = stkDesignBody(1, 'classic', ['size' => 'l']);
        if ($revision === 'missing') {
            unset($body['base_revision']);
        } else {
            $body['base_revision'] = $revision;
        }

        $this->putJson($url, $body, ['Accept-Language' => 'de'])->assertUnprocessable()
            ->assertJsonPath('errors.base_revision.0', 'Lade den Sticker neu und versuch es noch einmal.');
        $this->putJson($url, $body, ['Accept-Language' => 'en'])->assertUnprocessable()
            ->assertJsonPath('errors.base_revision.0', 'Reload the sticker and try again.');

        expect($this->design->fresh()->options['size'])->toBe('m');
    })->with(['missing' => 'missing', 'negative' => -1, 'a string' => 'abc', 'null' => null]);

    it('blocks a custom line with a term of the block list, without naming it', function () {
        $rule = new KeywordRule;
        $rule->forceFill(['term' => 'schrottkarre', 'normalized' => KeywordNormaliser::term('schrottkarre'), 'list' => KeywordList::Block])->save();
        app(KeywordRules::class)->flush();
        Sanctum::actingAs($this->owner);

        $response = $this->putJson('/api/v1/vehicles/'.$this->vehicle->id.'/sticker-design', stkDesignBody(1, 'classic', ['custom_line' => 'Keine Schrottkarre']))
            ->assertUnprocessable()->assertJsonPath('code', 'content_blocked');

        expect((string) $response->getContent())->not->toContain('chrottkarre');
    });

    it('limits autosaves, previews, Scan-Tests, order links and downloads per member', function (string $limit, string $method, string $suffix) {
        config(["speedclub.rate_limits.$limit.max" => 1]);
        RateLimits::register();
        Sanctum::actingAs($this->owner);
        $url = str_starts_with($suffix, '/sticker-design') || str_starts_with($suffix, '/sticker/') ? '/api/v1/vehicles/'.$this->vehicle->id.$suffix : '/api/v1/sticker-designs/'.$this->design->id.$suffix;

        stkCall($method, $url);
        stkCall($method, $url)->assertStatus(429)->assertJsonPath('code', 'rate_limited')->assertHeader('Retry-After');
    })->with([
        'autosave' => ['sticker_designs', 'put', '/sticker-design'],
        'preview' => ['sticker_previews', 'post', '/sticker-design/preview'],
        'scan test' => ['sticker_validations', 'post', '/sticker-design/validate'],
        'order link' => ['sticker_orders', 'post', '/order-link'],
        'download' => ['qr_downloads', 'get', '/print.svg'],
    ]);
});

describe('preview', function () {
    it('renders the unsaved state as SVG and stores nothing', function () {
        Sanctum::actingAs($this->owner);

        $response = $this->postJson('/api/v1/vehicles/'.$this->vehicle->id.'/sticker-design/preview', ['template' => 'vertical_jdm', 'options' => ['size' => 'l', 'car_name' => true]])
            ->assertOk()
            ->assertJsonPath('data.size_mm', ['width' => 64, 'height' => 240])
            ->assertJsonPath('data.warnings', []);

        expect($response->json('data.svg'))->toStartWith('<?xml')->toContain('viewBox="0 0 64 240"')->toContain('id="qr"')
            ->and($response->json('data.qr_mm'))->toBeGreaterThanOrEqual(25)
            ->and(StickerDesign::query()->count())->toBe(1)
            ->and($this->design->fresh()->template->value)->toBe('classic');
    });

    it('warns without a code', function () {
        Sanctum::actingAs($this->owner);

        $this->postJson('/api/v1/vehicles/'.$this->vehicle->id.'/sticker-design/preview', ['template' => 'classic', 'options' => ['qr' => false]])
            ->assertOk()->assertJsonPath('data.warnings', ['qr_off'])->assertJsonPath('data.qr_mm', null);

        app(QrCodes::class)->revoke($this->vehicle, QrRevocationReason::Moderation);

        $this->postJson('/api/v1/vehicles/'.$this->vehicle->id.'/sticker-design/preview', ['template' => 'classic', 'options' => []])
            ->assertOk()->assertJsonPath('data.warnings', ['no_active_code']);
    });

    it('refuses white ink on white vinyl', function () {
        Sanctum::actingAs($this->owner);

        $this->postJson('/api/v1/vehicles/'.$this->vehicle->id.'/sticker-design/preview', ['template' => 'classic', 'options' => ['material' => 'white_vinyl']])
            ->assertUnprocessable()->assertJsonValidationErrors('options.material');
    });
});

describe('POST sticker-design/validate (Scan-Test)', function () {
    beforeEach(function () {
        $this->design->forceFill(['validated_at' => null, 'scan_test' => null, 'qr_code_id' => null])->save();
        $this->url = '/api/v1/vehicles/'.$this->vehicle->id.'/sticker-design/validate';
    });

    it('decodes the print layout on the server and freezes the version with the code', function () {
        Sanctum::actingAs($this->owner);

        $this->postJson($this->url, ['version' => 1, 'client_scan_test' => 'passed'])->assertOk()
            ->assertJsonPath('data.state', 'validated')
            ->assertJsonPath('data.scan_test', 'passed')
            ->assertJsonPath('data.code', ['display_code' => app(QrCodes::class)->displayCode($this->qr->code), 'active' => true])
            ->assertJsonPath('data.urls.print_pdf', route('api.v1.sticker-designs.print-pdf', ['design' => $this->design->id]));

        $design = $this->design->fresh();
        expect($design->qr_code_id)->toBe($this->qr->id)
            ->and($design->client_scan_test?->value)->toBe('passed')
            ->and($design->validated_at)->not->toBeNull();
    });

    it('validates a design without a code as not_applicable', function () {
        $this->design->forceFill(['options' => [...$this->design->options, 'qr' => false]])->save();
        Sanctum::actingAs($this->owner);

        $this->postJson($this->url, ['version' => 1])->assertOk()
            ->assertJsonPath('data.scan_test', 'not_applicable')
            ->assertJsonPath('data.warnings', ['qr_off'])
            ->assertJsonPath('data.code', null);
    });

    it('answers 409 for a stale version and when staff took the code down', function () {
        Sanctum::actingAs($this->owner);

        $this->postJson($this->url, ['version' => 2])->assertStatus(409)->assertJsonPath('code', 'edit_conflict');

        app(QrCodes::class)->revoke($this->vehicle, QrRevocationReason::Moderation);
        $this->postJson($this->url, ['version' => 1])->assertStatus(409)->assertJsonPath('code', 'sticker_no_active_code');
    });

    it('never freezes a draft that an autosave changed while it was being rendered (review MF-1)', function () {
        // The scanner double plays the autosave that lands during the 1–3 s render: same version, other template.
        $design = $this->design;
        $this->mock(StickerScanner::class)->shouldReceive('test')->andReturnUsing(function () use ($design): array {
            $design->fresh()->forceFill(['options' => [...$design->options, 'username' => ! ($design->options['username'] ?? true)]])->save();

            return ['passed' => true, 'decoded' => 'irrelevant'];
        });
        Sanctum::actingAs($this->owner);

        $this->postJson($this->url, ['version' => 1, 'client_scan_test' => 'passed'])->assertStatus(409)->assertJsonPath('code', 'edit_conflict');

        expect($this->design->fresh()->validated_at)->toBeNull()
            ->and($this->design->fresh()->scan_test)->toBeNull()
            ->and($this->design->fresh()->qr_code_id)->toBeNull();
    });

    it('stores a failed server test on the draft and answers 422', function () {
        $this->mock(StickerScanner::class)->shouldReceive('test')->andReturn(['passed' => false, 'decoded' => null]);
        Sanctum::actingAs($this->owner);

        $this->postJson($this->url, ['version' => 1])->assertUnprocessable()->assertJsonPath('code', 'sticker_scan_failed');

        expect($this->design->fresh()->scan_test)->toBe(StickerScanTest::Failed)
            ->and($this->design->fresh()->validated_at)->toBeNull();
    });

    it('moves a validated design to the new code after a reissue, as the next version', function () {
        $this->design->forceFill(['validated_at' => now(), 'scan_test' => StickerScanTest::Passed, 'qr_code_id' => $this->qr->id])->save();
        $this->postJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr/reissue')->assertUnauthorized();
        Sanctum::actingAs($this->owner);
        $this->postJson('/api/v1/vehicles/'.$this->vehicle->id.'/qr/reissue')->assertOk();
        $new = $this->vehicle->activeQrCode()->firstOrFail();

        $this->get('/api/v1/sticker-designs/'.$this->design->id.'/print.pdf', ['Accept' => 'application/json'])->assertStatus(409)->assertJsonPath('code', 'sticker_code_replaced');

        $this->postJson($this->url, ['version' => 1])->assertOk()
            ->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.revision', 1)
            ->assertJsonPath('data.state', 'validated')
            ->assertJsonPath('data.code.display_code', app(QrCodes::class)->displayCode($new->code));
    });

    it('replays with the same Idempotency-Key', function () {
        Sanctum::actingAs($this->owner);

        $first = $this->postJson($this->url, ['version' => 1], ['Idempotency-Key' => 'stk-validate-1'])->assertOk();
        $second = $this->postJson($this->url, ['version' => 1], ['Idempotency-Key' => 'stk-validate-1'])->assertOk()->assertHeader('Idempotency-Replayed');

        expect($second->json())->toBe($first->json());
    });

    it('validates the request', function () {
        Sanctum::actingAs($this->owner);

        $this->postJson($this->url, ['client_scan_test' => 'maybe'])->assertUnprocessable()->assertJsonValidationErrors(['version', 'client_scan_test']);
    });
});

describe('files of a version', function () {
    it('serves the print SVG and PNG with the sticker code, the share PNG with the page address only', function () {
        Sanctum::actingAs($this->owner);
        $payload = app(QrCodes::class)->payload($this->qr);

        $svg = $this->get('/api/v1/sticker-designs/'.$this->design->id.'/print.svg')->assertOk()
            ->assertHeader('Content-Type', 'image/svg+xml')
            ->assertHeader('Cache-Control', 'no-store, private');
        expect(stkDecode(stkSvgQrImage((string) $svg->getContent(), StickerColourway::White)))->toBe($payload)
            ->and((string) $svg->headers->get('Content-Disposition'))->toContain('speedclub-sticker-'.$this->design->reference.'-v1.svg');

        $print = $this->get('/api/v1/sticker-designs/'.$this->design->id.'/print.png')->assertOk()->assertHeader('Content-Type', 'image/png');
        $image = imagecreatefromstring((string) $print->getContent());
        // 300 dpi of 156 mm.
        expect(imagesx($image))->toBe((int) ceil(156 * 300 / 25.4));

        $share = $this->get('/api/v1/sticker-designs/'.$this->design->id.'/share.png')->assertOk();
        $decoded = readQrText((string) $share->getContent());
        expect($decoded)->toBe(app(QrCodes::class)->pageUrl($this->vehicle))
            ->and(strtoupper($decoded))->not->toContain($this->qr->code);
    });

    it('refuses print files and the order link of a draft', function (string $suffix, string $method) {
        $this->design->forceFill(['validated_at' => null])->save();
        Sanctum::actingAs($this->owner);

        stkCall($method, '/api/v1/sticker-designs/'.$this->design->id.$suffix)->assertStatus(409)->assertJsonPath('code', 'sticker_not_validated');
    })->with([['/print.svg', 'get'], ['/print.pdf', 'get'], ['/print.png', 'get'], ['/order-link', 'post']]);

    it('serves a preview SVG of any version', function () {
        $this->design->forceFill(['validated_at' => null])->save();
        Sanctum::actingAs($this->owner);

        $this->get('/api/v1/sticker-designs/'.$this->design->id.'/preview.svg')->assertOk()->assertHeader('Content-Type', 'image/svg+xml');
    });
});

describe('POST sticker-designs/{id}/order-link', function () {
    it('says "Bestellung bald verfügbar" while no store is configured', function () {
        Sanctum::actingAs($this->owner);

        $this->postJson('/api/v1/sticker-designs/'.$this->design->id.'/order-link', [], ['Accept-Language' => 'de'])->assertOk()
            ->assertJsonPath('data', ['available' => false, 'url' => null, 'reason' => 'not_configured', 'message' => 'Bestellung bald verfügbar']);

        expect($this->design->fresh()->order_requested_at)->toBeNull();
    });

    it('builds the Shopify cart permalink with the design and the car as cart attributes, per size', function () {
        config(['speedclub.stickers.shop' => ['domain' => 'https://Speedclub-Shop.myshopify.com/', 'variant' => '111', 'variants' => ['s' => null, 'm' => '4242', 'l' => null]]]);
        Sanctum::actingAs($this->owner);

        $this->postJson('/api/v1/sticker-designs/'.$this->design->id.'/order-link')->assertOk()
            ->assertJsonPath('data.available', true)
            ->assertJsonPath('data.url', 'https://speedclub-shop.myshopify.com/cart/4242:1?attributes[sticker_design]='.$this->design->reference.'&attributes[vehicle]='.$this->vehicle->canonicalSlug().'&storefront=true');

        expect($this->design->fresh()->order_requested_at)->not->toBeNull();

        // Size S has no own variant: the one for all sizes.
        $this->design->forceFill(['options' => [...$this->design->options, 'size' => 's']])->save();
        $this->postJson('/api/v1/sticker-designs/'.$this->design->id.'/order-link')->assertOk()->assertJsonPath('data.url', fn (string $url) => str_contains($url, '/cart/111:1?'));
    });

    it('ignores a variant id that is no number and a domain that is no host', function () {
        config(['speedclub.stickers.shop' => ['domain' => 'not a host', 'variant' => '123', 'variants' => []]]);
        Sanctum::actingAs($this->owner);
        $this->postJson('/api/v1/sticker-designs/'.$this->design->id.'/order-link')->assertOk()->assertJsonPath('data.available', false);

        config(['speedclub.stickers.shop' => ['domain' => 'shop.example.com', 'variant' => '12a', 'variants' => []]]);
        $this->postJson('/api/v1/sticker-designs/'.$this->design->id.'/order-link')->assertOk()->assertJsonPath('data.available', false);
    });

    it('encodes the attribute values', function () {
        config(['speedclub.stickers.shop' => ['domain' => 'shop.example.com', 'variant' => '9', 'variants' => []]]);
        $link = app(StickerOrderLink::class);
        $vehicle = Mockery::mock(Vehicle::class)->makePartial();
        $vehicle->shouldReceive('canonicalSlug')->andReturn('golf & co');

        expect($link->url($this->design, $vehicle))->toContain('attributes[vehicle]=golf%20%26%20co');
    });
});
