<?php

use App\Enums\ModTagStatus;
use App\Models\Block;
use App\Models\BusinessInvite;
use App\Models\BusinessMember;
use App\Models\BusinessViewDay;
use App\Models\Media;
use App\Models\ModBusinessTag;
use App\Models\User;
use Carbon\CarbonImmutable;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/BusinessTestHelpers.php';

/**
 * M4.18 backend polish of the business APIs: the invitation card carries the ADR-457 cover, GET me/business answers `data: null` before
 * a business exists (BIZ-02 asks first; a 404 was logged as a console error), BIZ-03's views ignore machines, prefetches and the QA
 * matrix's renders (DQ-1148), `locked_fields` is in the OpenAPI document, and the daily views are pruned after views_retention_days.
 */
beforeEach(function () {
    bizFlags();
    $this->owner = User::factory()->create(['username' => 'kanal.werkstatt']);
    $this->business = bizBusiness($this->owner, ['slug' => 'werkstatt-am-kanal', 'name' => 'Werkstatt am Kanal']);
});

function polishViews(): int
{
    return (int) BusinessViewDay::query()->sum('views');
}

describe('GET me/business before a business exists', function () {
    it('answers 200 with data null to a member without a business', function () {
        Sanctum::actingAs(User::factory()->create());

        $this->getJson('/api/v1/me/business')->assertOk()->assertExactJson(['data' => null]);
    });

    it('answers the owner and the staff with their business', function () {
        Sanctum::actingAs($this->owner);
        $this->getJson('/api/v1/me/business')->assertOk()->assertJsonPath('data.slug', 'werkstatt-am-kanal')->assertJsonPath('data.viewer_role', 'owner');

        $staff = User::factory()->create();
        BusinessMember::factory()->create(['business_id' => $this->business->id, 'user_id' => $staff->id]);
        Sanctum::actingAs($staff);
        $this->getJson('/api/v1/me/business')->assertOk()->assertJsonPath('data.viewer_role', 'staff');
    });

    it('gives an invited member no business until they accept', function () {
        $invitee = User::factory()->create(['username' => 'nina.e36']);
        Sanctum::actingAs($this->owner);
        $this->postJson('/api/v1/me/business/members', ['username' => 'nina.e36'])->assertOk();

        Sanctum::actingAs($invitee);
        $this->getJson('/api/v1/me/business')->assertOk()->assertExactJson(['data' => null]);
    });

    it('keeps 401 for guests and 404 feature_disabled while the flag is off; the other routes still answer 404 without a business', function () {
        $this->getJson('/api/v1/me/business')->assertUnauthorized();

        Sanctum::actingAs(User::factory()->create());
        $this->patchJson('/api/v1/me/business', ['about' => 'x'])->assertNotFound()->assertJsonPath('code', 'business_unavailable');

        bizFlags(['businesses' => false]);
        $this->getJson('/api/v1/me/business')->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    });
});

describe('GET me/business-invites', function () {
    it('gives the invitation card the portfolio cover when the business has no cover of its own (ADR-457)', function () {
        $mod = bizBuildWithMod();
        ModBusinessTag::factory()->create(['mod_id' => $mod->id, 'business_id' => $this->business->id, 'status' => ModTagStatus::Accepted]);
        $mod->forceFill(['installed_by_business_id' => $this->business->id])->saveQuietly();
        bizRebuild($mod->vehicle);
        $buildPhoto = Media::query()->where('mediable_type', 'vehicle')->where('mediable_id', $mod->vehicle_id)->value('id');
        $invitee = User::factory()->create();
        BusinessInvite::factory()->create(['business_id' => $this->business->id, 'user_id' => $invitee->id, 'invited_by' => $this->owner->id]);

        Sanctum::actingAs($invitee);
        $this->getJson('/api/v1/me/business-invites')->assertOk()
            ->assertJsonPath('data.0.business.cover.id', $buildPhoto)
            ->assertJsonPath('data.0.business.cover_source', 'portfolio');
    });

    it('keeps the business\'s own cover first', function () {
        $cover = Media::factory()->forModel($this->business)->create(['owner_id' => $this->owner->id]);
        $this->business->forceFill(['cover_media_id' => $cover->id])->save();
        $invitee = User::factory()->create();
        BusinessInvite::factory()->create(['business_id' => $this->business->id, 'user_id' => $invitee->id, 'invited_by' => $this->owner->id]);

        Sanctum::actingAs($invitee);
        $this->getJson('/api/v1/me/business-invites')->assertOk()
            ->assertJsonPath('data.0.business.cover.id', $cover->id)
            ->assertJsonPath('data.0.business.cover_source', 'business');
    });

    it('shows nobody else\'s invitations and none of a blocked owner', function () {
        $invitee = User::factory()->create();
        BusinessInvite::factory()->create(['business_id' => $this->business->id, 'user_id' => $invitee->id, 'invited_by' => $this->owner->id]);

        Sanctum::actingAs(User::factory()->create());
        $this->getJson('/api/v1/me/business-invites')->assertOk()->assertJsonCount(0, 'data');

        Block::factory()->create(['blocker_id' => $invitee->id, 'blocked_id' => $this->owner->id]);
        Sanctum::actingAs($invitee);
        $this->getJson('/api/v1/me/business-invites')->assertOk()->assertJsonCount(0, 'data');

        app('auth')->forgetGuards();
        $this->getJson('/api/v1/me/business-invites')->assertUnauthorized();
    });
});

describe('BIZ-03 profile views (DQ-1148)', function () {
    it('counts a person\'s view on the API and on /b/{slug}', function () {
        $this->getJson('/api/v1/businesses/werkstatt-am-kanal', ['User-Agent' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'])->assertOk();
        $this->get('/b/werkstatt-am-kanal', ['User-Agent' => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15'])->assertOk();

        expect(polishViews())->toBe(2);
    });

    it('ignores machines and prefetches', function () {
        $this->getJson('/api/v1/businesses/werkstatt-am-kanal', ['User-Agent' => 'Mozilla/5.0 (compatible; Googlebot/2.1)'])->assertOk();
        $this->get('/b/werkstatt-am-kanal', ['User-Agent' => 'Mozilla/5.0 Chrome-Lighthouse'])->assertOk();
        $this->get('/b/werkstatt-am-kanal', ['User-Agent' => 'Mozilla/5.0 Safari/605.1.15', 'Sec-Purpose' => 'prefetch'])->assertOk();

        expect(polishViews())->toBe(0);
    });

    it('ignores the QA matrix\'s renders outside production: a qa* override on the page or on the app page that asked', function () {
        $browser = ['User-Agent' => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'];

        $this->get('/b/werkstatt-am-kanal?qaNow=2026-11-02T10:00:00Z&qaMotion=off', $browser)->assertOk();
        $this->getJson('/api/v1/businesses/werkstatt-am-kanal', [...$browser, 'Referer' => 'http://localhost/app/b/werkstatt-am-kanal?flags=businesses&qaNow=2026-11-02T10:00:00Z'])->assertOk();
        expect(polishViews())->toBe(0);

        // A page without overrides still counts, also with a Referer.
        $this->getJson('/api/v1/businesses/werkstatt-am-kanal', [...$browser, 'Referer' => 'http://localhost/app/b/werkstatt-am-kanal'])->assertOk();
        expect(polishViews())->toBe(1);
    });

    it('counts a view with qa* parameters in production, where the overrides do not exist', function () {
        app()->detectEnvironment(fn () => 'production');

        $this->getJson('/api/v1/businesses/werkstatt-am-kanal', ['User-Agent' => 'Mozilla/5.0 Safari/605.1.15', 'Referer' => 'https://speedclub.de/app/b/werkstatt-am-kanal?qaNow=x'])->assertOk();

        expect(polishViews())->toBe(1);
    });

    it('prunes daily views older than views_retention_days and keeps the window BIZ-03 sums', function () {
        config(['speedclub.businesses.views_retention_days' => 400]);
        $today = CarbonImmutable::now(config()->string('speedclub.display_timezone'));
        foreach ([0, 29, 399, 400, 800] as $daysAgo) {
            BusinessViewDay::query()->create(['business_id' => $this->business->id, 'day' => $today->subDays($daysAgo)->toDateString(), 'views' => 1]);
        }

        $this->artisan('speedclub:prune-platform')->assertSuccessful();

        expect(BusinessViewDay::query()->count())->toBe(3);

        // Never shorter than the dashboard's window.
        config(['speedclub.businesses.views_retention_days' => 7]);
        $this->artisan('speedclub:prune-platform')->assertSuccessful();

        expect(BusinessViewDay::query()->count())->toBe(2);
    });
});

it('documents locked_fields and a nullable GET me/business in the OpenAPI document', function () {
    $path = storage_path('framework/testing/m418-openapi-'.getmypid().'.json');
    $this->artisan('scramble:export', ['--path' => $path])->assertSuccessful();
    $document = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
    @unlink($path);

    expect($document['components']['schemas']['MyBusinessResource']['properties']['locked_fields'] ?? null)
        ->toMatchArray(['type' => 'array', 'items' => ['type' => 'string']])
        ->and($document['components']['schemas']['MyBusinessResource']['required'])->toContain('locked_fields');

    // One answer is the business, the other `{"data": null}` (NoBusinessResource, a schema of its own since the arch rule's fix).
    $alternatives = $document['paths']['/me/business']['get']['responses']['200']['content']['application/json']['schema']['anyOf'] ?? [];
    $resolved = array_map(function (array $schema) use ($document): array {
        $ref = $schema['$ref'] ?? null;

        return is_string($ref) ? $document['components']['schemas'][substr($ref, strlen('#/components/schemas/'))] : $schema;
    }, $alternatives);
    $data = array_map(fn (array $schema): mixed => $schema['properties']['data'] ?? null, $resolved);
    expect($data)->toContain(['$ref' => '#/components/schemas/MyBusinessResource'])->toContain(['type' => 'null']);
});
