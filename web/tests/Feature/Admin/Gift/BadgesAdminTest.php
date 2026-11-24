<?php

use App\Jobs\Badges\ApplyBadgeSlice;
use App\Models\AuditEvent;
use App\Models\Badge;
use App\Models\User;
use App\Models\UserBadge;
use App\Models\Vehicle;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;
use Inertia\Testing\AssertableInertia;

require_once __DIR__.'/../Support/helpers.php';

/**
 * ADM-63 "Abzeichen" (M5.9d admin, m5.9d contract §2, ADR-513): content.view reads (list, badge, preview), content.edit writes (Owner,
 * Admin, Content editor; on the route ahead of the password check, so another role hears 403 and changes nothing). Every write needs a
 * recent password (ADR-215), is audited by its Action (`badge.created|updated|activated|deactivated|applied`) and never four-eyes. The
 * rule is a whitelisted metric + condition + value; anything else is a field error on `rule_json`.
 */
const ADM63_ROLES = ['owner', 'admin', 'content_editor'];

function adm63As(string $role): void
{
    seedStaffRoles();
    actingAsStaff(staffWithRole($role));
    test()->withSession(['auth.password_confirmed_at' => time()]);
}

/** @return array<string, mixed> */
function adm63Input(array $overrides = []): array
{
    return [
        'key' => 'garagen-start',
        'name_de' => 'Garagen-Start',
        'name_en' => 'Garage start',
        'description_de' => 'Du hast zwei Autos in deiner Garage veröffentlicht.',
        'description_en' => 'You published two cars in your garage.',
        'hint_de' => null,
        'hint_en' => null,
        'hidden' => false,
        'tier' => 'silver',
        'category' => 'garage',
        'sort' => 40,
        'active' => true,
        'rule_json' => ['metric' => 'published_vehicles', 'gte' => 2],
        ...$overrides,
    ];
}

/** A real member with $cars published public cars. */
function adm63Member(int $cars = 1, array $attributes = []): User
{
    $member = User::factory()->create(['created_at' => now()->subDays(3), ...$attributes]);
    Vehicle::factory()->count($cars)->published()->create(['owner_id' => $member->id, 'visibility' => 'public']);

    return $member;
}

// ---- authorisation matrix ---------------------------------------------------------------------------------------------------------

it('lets content.view read the list, a badge, the form and the preview', function (string $uri, ?string $component) {
    $badge = Badge::factory()->create(['key' => 'erster-build']);
    $uri = str_replace('{badge}', $badge->key, $uri);

    assertAdminMatrix('GET', $uri, ADM63_ROLES, function (TestResponse $r) use ($component): void {
        $r->assertOk();
        if ($component !== null) {
            $r->assertInertia(fn (AssertableInertia $page) => $page->component($component));
        }
    });
})->with([
    'list' => ['/admin/content/badges', 'Badges/Index'],
    'badge' => ['/admin/content/badges/{badge}', 'Badges/Edit'],
    'new' => ['/admin/content/badges/new', 'Badges/Edit'],
    'preview' => ['/admin/content/badges/preview?metric=published_vehicles&gte=1', null],
]);

it('guards every write by content.edit, ahead of the password check', function (string $method, string $uri, array $data) {
    $badge = Badge::factory()->create(['key' => 'erster-build']);
    $before = $badge->fresh()?->toArray();
    Queue::fake();

    assertAdminMatrix($method, str_replace('{badge}', $badge->key, $uri), ADM63_ROLES, function (TestResponse $r): void {
        // No recent password: the confirm answer, never a change.
        expect($r->status())->toBeIn([302, 303, 423]);
    }, $data);

    expect(Badge::query()->count())->toBe(1)
        ->and($badge->fresh()?->toArray())->toBe($before)
        ->and(AuditEvent::query()->where('action', 'like', 'badge.%')->count())->toBe(0);
    Queue::assertNothingPushed();
})->with([
    'create' => ['POST', '/admin/content/badges', adm63Input()],
    'update' => ['PATCH', '/admin/content/badges/{badge}', adm63Input(['name_de' => 'Neu'])],
    'deactivate' => ['POST', '/admin/content/badges/{badge}/active', ['active' => false]],
    'apply' => ['POST', '/admin/content/badges/{badge}/apply', []],
]);

it('hands every content.edit role the editable list and form', function (string $role) {
    Badge::factory()->create(['key' => 'erster-build']);
    adm63As($role);

    $this->get('/admin/content/badges')->assertInertia(fn (AssertableInertia $page) => $page->where('canEdit', true));
    $this->get('/admin/content/badges/erster-build')->assertInertia(fn (AssertableInertia $page) => $page->where('canEdit', true));
})->with(ADM63_ROLES);

it('answers 404 for an unknown badge', function () {
    adm63As('admin');

    assertAdminErrorPage($this->get('/admin/content/badges/gibt-es-nicht'), 404);
    $this->patch('/admin/content/badges/gibt-es-nicht', adm63Input())->assertNotFound();
    $this->post('/admin/content/badges/gibt-es-nicht/apply')->assertNotFound();
});

// ---- the list ----------------------------------------------------------------------------------------------------------------------

it('lists badges in app order with category, tier, hidden, status, earned and rule, and filters them', function () {
    $one = Badge::factory()->create(['key' => 'erster-build', 'sort' => 10]);
    Badge::factory()->hidden()->create(['key' => 'erstentdecker', 'name_de' => 'Erstentdecker', 'sort' => 20, 'category' => 'spotting', 'rule_json' => ['metric' => 'first_spotter_foils', 'gte' => 10]]);
    Badge::factory()->inactive()->create(['key' => 'forum-helfer', 'sort' => 5, 'category' => 'forum', 'tier' => 'silver']);
    UserBadge::factory()->count(2)->create(['badge_key' => $one->key]);
    adm63As('content_editor');

    $rows = $this->get('/admin/content/badges')->assertOk()->inertiaProps('rows.data');
    expect(array_column($rows, 'key'))->toBe(['forum-helfer', 'erster-build', 'erstentdecker'])
        ->and($rows[1])->toMatchArray(['earned' => 2, 'category' => 'garage', 'tier' => 'bronze', 'hidden' => false, 'active' => true])
        ->and($rows[1]['rule'])->toEqual(['metric' => 'published_vehicles', 'gte' => 1])
        ->and($rows[2]['hidden'])->toBeTrue();

    $keys = fn (string $query): array => array_column($this->get('/admin/content/badges?'.$query)->inertiaProps('rows.data'), 'key');
    expect($keys('filter[hidden]=yes'))->toBe(['erstentdecker'])
        ->and($keys('filter[active]=no'))->toBe(['forum-helfer'])
        ->and($keys('filter[category]=spotting'))->toBe(['erstentdecker'])
        ->and($keys('filter[tier]=silver'))->toBe(['forum-helfer'])
        ->and($keys('filter[q]=erstent'))->toBe(['erstentdecker'])
        ->and($keys('filter[category]=unbekannt'))->toHaveCount(3)
        ->and($keys('sort=-earned'))->toBe(['erster-build', 'erstentdecker', 'forum-helfer']);
});

// ---- create, update ----------------------------------------------------------------------------------------------------------------

it('creates a badge, audits it and opens it', function () {
    adm63As('content_editor');

    $this->post('/admin/content/badges', adm63Input())
        ->assertStatus(303)
        ->assertRedirect('/admin/content/badges/garagen-start')
        ->assertSessionHas('success', 'gift.badges.flash.created');

    $badge = Badge::query()->findOrFail('garagen-start');
    $event = AuditEvent::query()->where('action', 'badge.created')->sole();
    // MySQL stores JSON objects with its own key order: compare the pairs, not the order.
    expect($badge->rule_json)->toEqual(['metric' => 'published_vehicles', 'gte' => 2])
        ->and($badge->tier->value)->toBe('silver')
        ->and($badge->sort)->toBe(40)
        ->and($event->target_id)->toBe('garagen-start')
        ->and($event->after['rule_json'])->toEqual(['metric' => 'published_vehicles', 'gte' => 2]);
});

it('updates a badge with before and after, keeps its key and earned rows', function () {
    $badge = Badge::factory()->create(['key' => 'erster-build']);
    UserBadge::factory()->create(['badge_key' => $badge->key]);
    adm63As('admin');

    $this->patch('/admin/content/badges/erster-build', adm63Input(['key' => 'anderer-key', 'name_de' => 'Erster Wagen', 'rule_json' => ['metric' => 'published_vehicles', 'gte' => 1]]))
        ->assertStatus(303)
        ->assertSessionHas('success', 'gift.badges.flash.saved');

    $event = AuditEvent::query()->where('action', 'badge.updated')->sole();
    expect(Badge::query()->pluck('key')->all())->toBe(['erster-build'])
        ->and($badge->fresh()?->name_de)->toBe('Erster Wagen')
        ->and($event->before['name_de'])->toBe('Erster Build')
        ->and($event->after['name_de'])->toBe('Erster Wagen')
        ->and(UserBadge::query()->where('badge_key', 'erster-build')->count())->toBe(1);
});

it('refuses bad input with field errors and changes nothing', function (array $overrides, string $field) {
    adm63As('admin');

    $this->post('/admin/content/badges', adm63Input($overrides))->assertSessionHasErrors($field);

    expect(Badge::query()->count())->toBe(0)
        ->and(AuditEvent::query()->where('action', 'like', 'badge.%')->count())->toBe(0);
})->with([
    'name too long' => [['name_de' => str_repeat('a', 81)], 'name_de'],
    'description too long' => [['description_en' => str_repeat('a', 256)], 'description_en'],
    'hint too long' => [['hint_de' => str_repeat('a', 161), 'hint_en' => 'Hinweis'], 'hint_de'],
    'hidden without hint' => [['hidden' => true], 'hint_de'],
    'key with capitals' => [['key' => 'Erster-Build'], 'key'],
    'reserved key' => [['key' => 'new'], 'key'],
    'unknown tier' => [['tier' => 'platinum'], 'tier'],
    'unknown category' => [['category' => 'rennen'], 'category'],
    'unknown metric' => [['rule_json' => ['metric' => 'likes', 'gte' => 1]], 'rule_json'],
    'wrong operator' => [['rule_json' => ['metric' => 'sticker_active', 'gte' => 1]], 'rule_json'],
    'value out of range' => [['rule_json' => ['metric' => 'cars_spotted', 'gte' => 0]], 'rule_json'],
    'extra key' => [['rule_json' => ['metric' => 'cars_spotted', 'gte' => 5, 'sql' => '1=1']], 'rule_json'],
    'no rule' => [['rule_json' => null], 'rule_json'],
    'the hour of a spot (ADR-516 b)' => [['rule_json' => ['metric' => 'night_spots', 'gte' => 10]], 'rule_json'],
]);

it('refuses a night-spot rule on an existing badge, in the preview, and switching on a badge whose rule was retired (ADR-516 b)', function () {
    $badge = Badge::factory()->create(['key' => 'erster-build']);
    Badge::factory()->hidden()->inactive()->create(['key' => 'nachtschicht', 'category' => 'spotting', 'rule_json' => ['metric' => 'night_spots', 'gte' => 10]]);
    adm63As('content_editor');

    $this->patch('/admin/content/badges/erster-build', adm63Input(['key' => 'erster-build', 'rule_json' => ['metric' => 'night_spots', 'gte' => 1]]))->assertSessionHasErrors('rule_json');
    $this->getJson('/admin/content/badges/preview?metric=night_spots&gte=10')->assertStatus(422)->assertJsonValidationErrors('rule_json');
    $this->post('/admin/content/badges/nachtschicht/active', ['active' => true])->assertSessionHasErrors('active');

    expect($badge->fresh()?->rule_json)->toEqual($badge->rule_json)
        ->and(Badge::query()->findOrFail('nachtschicht')->active)->toBeFalse()
        ->and(AuditEvent::query()->where('action', 'like', 'badge.%')->count())->toBe(0);
    $this->get('/admin/content/badges/new')->assertInertia(fn (AssertableInertia $page) => $page
        ->where('metrics', fn ($metrics): bool => ! collect($metrics)->contains('key', 'night_spots')));

    // The retired row still reads as words in the list (never a raw key), and the label says it can no longer be chosen.
    foreach (['de' => 'nicht mehr verfügbar', 'en' => 'no longer available'] as $locale => $words) {
        $labels = json_decode((string) file_get_contents(lang_path("admin/$locale/gift.json")), true)['badges']['metrics'];
        expect($labels['night_spots'])->toContain($words);
    }
});

it('refuses a key that exists', function () {
    Badge::factory()->create(['key' => 'garagen-start']);
    adm63As('admin');

    $this->post('/admin/content/badges', adm63Input())->assertSessionHasErrors('key');
    expect(AuditEvent::query()->where('action', 'badge.created')->count())->toBe(0);
});

// ---- activate, apply, preview -----------------------------------------------------------------------------------------------------

it('deactivates and activates with an optional reason, audited once per change', function () {
    $badge = Badge::factory()->create(['key' => 'erster-build']);
    adm63As('content_editor');

    $this->post('/admin/content/badges/erster-build/active', ['active' => false, 'reason' => 'Treffen gibt es noch nicht.'])->assertSessionHas('success', 'gift.badges.flash.deactivated');
    $this->post('/admin/content/badges/erster-build/active', ['active' => false])->assertStatus(303);
    $this->post('/admin/content/badges/erster-build/active', ['active' => true])->assertSessionHas('success', 'gift.badges.flash.activated');

    expect($badge->fresh()?->active)->toBeTrue()
        ->and(AuditEvent::query()->where('action', 'badge.deactivated')->sole()->reason)->toBe('Treffen gibt es noch nicht.')
        ->and(AuditEvent::query()->where('action', 'badge.activated')->count())->toBe(1);

    $this->post('/admin/content/badges/erster-build/active', ['active' => false, 'reason' => str_repeat('x', 1001)])->assertSessionHasErrors('reason');
});

it('applies an active badge now (queued, audited) and refuses an inactive one', function () {
    Queue::fake();
    Badge::factory()->create(['key' => 'erster-build']);
    Badge::factory()->inactive()->create(['key' => 'forum-helfer']);
    adm63As('admin');

    $this->post('/admin/content/badges/erster-build/apply')->assertStatus(303)->assertSessionHas('success', 'gift.badges.flash.applied');
    $this->post('/admin/content/badges/forum-helfer/apply')->assertSessionHasErrors('active');

    Queue::assertPushed(ApplyBadgeSlice::class, 1);
    expect(AuditEvent::query()->where('action', 'badge.applied')->sole()->target_id)->toBe('erster-build');
});

it('previews how many real members a rule reaches today, and refuses a rule outside the whitelist', function () {
    adm63Member(2);
    adm63Member(1);
    adm63Member(3, ['is_sample' => true]);
    adm63As('content_editor');

    $this->getJson('/admin/content/badges/preview?metric=published_vehicles&gte=1')->assertOk()->assertExactJson(['data' => ['count' => 2]]);
    $this->getJson('/admin/content/badges/preview?metric=published_vehicles&gte=2')->assertOk()->assertExactJson(['data' => ['count' => 1]]);
    $this->getJson('/admin/content/badges/preview?metric=likes&gte=1')->assertStatus(422)->assertJsonValidationErrors('rule_json');
    $this->getJson('/admin/content/badges/preview?metric=published_vehicles&gte=abc')->assertStatus(422)->assertJsonValidationErrors('rule_json');
    $this->getJson('/admin/content/badges/preview?metric=sticker_active&eq=true')->assertOk()->assertJsonPath('data.count', 0);
});

it('hands the form the whitelisted metrics, Dex sets, tiers and categories, and the badge with its earned count', function () {
    $badge = Badge::factory()->create(['key' => 'erster-build']);
    UserBadge::factory()->count(3)->create(['badge_key' => $badge->key]);
    adm63As('content_editor');

    $this->get('/admin/content/badges/erster-build')->assertInertia(fn (AssertableInertia $page) => $page
        ->component('Badges/Edit')
        ->where('badge.key', 'erster-build')
        ->where('badge.earned', 3)
        ->where('badge.rule', ['metric' => 'published_vehicles', 'gte' => 1])
        ->where('tiers', ['bronze', 'silver', 'gold'])
        // 19 since ADR-516 b removed night_spots; 21 since M5.7 added views_received and helpful_received (10 §6.4).
        ->has('metrics', 21)
        ->where('metrics.0', ['key' => 'published_vehicles', 'boolean' => false, 'parameter' => null])
        ->has('sets')
        ->has('activity'));
});
