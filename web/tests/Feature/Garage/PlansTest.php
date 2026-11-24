<?php

use App\Actions\Admin\Members\StartViewAs;
use App\Enums\ModPriority;
use App\Enums\ModStatus;
use App\Enums\RestrictionType;
use App\Http\RateLimits;
use App\Models\Block;
use App\Models\BuildUpdate;
use App\Models\FeatureFlag;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\DataExport\ExportContents;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/GarageTestHelpers.php';
require_once __DIR__.'/../Admin/Actions/Helpers.php';

/**
 * M5.3 "Pläne" and Build-Fortschritt (10 §5.9, §6.2; m5.3-contract): plan fields on the mods routes, POST mods/{id}/install,
 * PUT vehicles/{id}/plans/order, `plans` and `build_progress` on the vehicle page, and a budget that never leaves the owner.
 */
beforeEach(function () {
    Storage::fake('public');
    Storage::fake('local');
    seedModSchema();
    $this->withHeader('Accept-Language', 'de');
    $this->owner = User::factory()->create(['username' => 'plan.owner']);
    $this->vehicle = publishedVehicle($this->owner);
});

/**
 * A plan of the vehicle, outside SaveModification (no Verlauf entry of its own).
 *
 * @param  array<string, mixed>  $attributes
 */
function m53Plan(Vehicle $vehicle, array $attributes = []): Modification
{
    return Modification::factory()->planned()->create([
        'vehicle_id' => $vehicle->id,
        'category_id' => modCategory('suspension')->id,
        'brand_id' => null,
        'title' => 'KW V3',
        'part_name' => null,
        'fields' => ['type' => 'coilover'],
        ...$attributes,
    ]);
}

function m53Page(Vehicle $vehicle, string $suffix = ''): string
{
    return '/api/v1/public/vehicles/'.$vehicle->canonicalSlug().$suffix;
}

/**
 * @param  string  $content  a raw answer that names the plan but must not hold its budget
 */
function m53ExpectNoBudget(string $content): void
{
    expect($content)->not->toContain('987654')->not->toContain('9.876,54')->not->toContain('9,876.54')->toContain('Geheimplan');
}

describe('plan fields on POST vehicles/{id}/mods and PATCH mods/{id}', function () {
    it('creates a plan with target month, priority and private budget, at the end of the plans', function () {
        Sanctum::actingAs($this->owner);

        $first = $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", [
            'category' => 'suspension', 'title' => 'KW V3', 'status' => 'planned', 'fields' => ['type' => 'coilover'],
            'target_month' => '2027-03', 'priority' => 'high', 'budget_cents' => 180000,
        ])->assertCreated()
            ->assertJsonPath('data.status', 'planned')
            ->assertJsonPath('data.target_month', '2027-03')
            ->assertJsonPath('data.target_label', 'März 2027')
            ->assertJsonPath('data.is_due', false)
            ->assertJsonPath('data.priority', 'high')
            ->assertJsonPath('data.priority_label', 'Hoch')
            ->assertJsonPath('data.plan_sort', 0)
            ->assertJsonPath('data.budget.cents', 180000)
            ->assertJsonPath('data.budget.label', 'Budget 1.800 €')
            ->assertJsonPath('data.installed_on', null);

        $second = $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'exhaust', 'title' => 'Akrapovič', 'status' => 'planned', 'fields' => []])
            ->assertCreated()->assertJsonPath('data.plan_sort', 1)->assertJsonPath('data.target_month', null)->assertJsonPath('data.priority', null);

        expect(Modification::query()->findOrFail($first->json('data.id'))->target_month?->format('Y-m-d'))->toBe('2027-03-01')
            ->and($second->json('data.budget'))->toBeNull();
    });

    it('drops target month and priority for a mod that is not planned, keeps the budget for the owner', function () {
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", [
            'category' => 'exhaust', 'title' => 'Klappenauspuff', 'status' => 'installed', 'fields' => [], 'target_month' => '2027-03', 'priority' => 'low', 'budget_cents' => 5000,
        ])->assertCreated()
            ->assertJsonPath('data.target_month', null)
            ->assertJsonPath('data.priority', null)
            ->assertJsonPath('data.plan_sort', null)
            ->assertJsonPath('data.budget.cents', 5000);
    });

    it('validates the plan fields', function (array $body, string $field) {
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'exhaust', 'status' => 'planned', 'fields' => [], ...$body])
            ->assertUnprocessable()->assertJsonPath('code', 'validation_failed')->assertJsonValidationErrorFor($field);
    })->with([
        'month format' => [['target_month' => '03/2027'], 'target_month'],
        'month too early' => [['target_month' => '1999-12'], 'target_month'],
        'month too far ahead' => [fn () => ['target_month' => now()->addYears(11)->format('Y-m')], 'target_month'],
        'priority' => [['priority' => 'urgent'], 'priority'],
        'negative budget' => [['budget_cents' => -1], 'budget_cents'],
        'budget too high' => [['budget_cents' => 100000001], 'budget_cents'],
        'plan_sort is the server\'s' => [['plan_sort' => 3], 'plan_sort'],
    ]);

    it('explains the target range in the member\'s language', function () {
        Sanctum::actingAs($this->owner);
        $max = Carbon::now(config()->string('speedclub.display_timezone'))->startOfMonth()->addYears(10)->format('m/Y');

        $this->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'exhaust', 'status' => 'planned', 'fields' => [], 'target_month' => '1999-01'])
            ->assertJsonPath('errors.target_month.0', "Der Zielmonat muss zwischen 01/2000 und $max liegen.");

        $this->withHeader('Accept-Language', 'en')
            ->postJson("/api/v1/vehicles/{$this->vehicle->id}/mods", ['category' => 'exhaust', 'status' => 'planned', 'fields' => [], 'target_month' => '1999-01'])
            ->assertJsonPath('errors.target_month.0', "The target month must be between 01/2000 and $max.");
    });

    it('accepts a past target month, so an overdue plan saves unchanged, and says it is due', function () {
        $plan = m53Plan($this->vehicle, ['target_month' => now()->subMonths(2)->startOfMonth()]);
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/mods/{$plan->id}", ['target_month' => now()->subMonths(2)->format('Y-m'), 'priority' => 'normal'])
            ->assertOk()->assertJsonPath('data.is_due', true);
    });

    it('writes no Verlauf entry and leaves search and updated_at alone for an edit of nothing but plan fields', function () {
        $plan = m53Plan($this->vehicle);
        $this->vehicle->forceFill(['updated_at' => now()->subDay()])->saveQuietly();
        $before = $this->vehicle->fresh()?->updated_at?->toIso8601String();
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/mods/{$plan->id}", ['target_month' => '2028-05', 'priority' => 'low', 'budget_cents' => 99])
            ->assertOk()
            ->assertJsonPath('data.history_recorded', false)
            ->assertJsonPath('data.target_month', '2028-05')
            ->assertJsonPath('data.priority', 'low')
            ->assertJsonPath('data.budget.cents', 99);

        expect(BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->count())->toBe(0)
            ->and($this->vehicle->fresh()?->updated_at?->toIso8601String())->toBe($before);
    });

    it('clears the plan fields when a plan leaves the plans through PATCH, and appends a mod that becomes planned', function () {
        $plan = m53Plan($this->vehicle, ['plan_sort' => 4]);
        $installed = modIn($this->vehicle, 'exhaust');
        Sanctum::actingAs($this->owner);

        $this->patchJson("/api/v1/mods/{$plan->id}", ['status' => 'installed'])->assertOk()
            ->assertJsonPath('data.target_month', null)->assertJsonPath('data.priority', null)->assertJsonPath('data.plan_sort', null)
            ->assertJsonPath('data.budget.cents', 120000);

        expect($plan->fresh()?->getAttributes())->toMatchArray(['target_month' => null, 'priority' => null, 'plan_sort' => null]);

        $this->patchJson("/api/v1/mods/{$installed->id}", ['status' => 'planned', 'target_month' => '2027-06'])->assertOk()
            ->assertJsonPath('data.plan_sort', 0)->assertJsonPath('data.target_month', '2027-06');
    });
});

describe('POST mods/{id}/install', function () {
    it('marks a plan as installed this month in Germany, tells Verlauf, keeps the budget', function () {
        // 23:30 UTC on 30 November is already December in Berlin.
        $this->travelTo(Carbon::parse('2026-11-30 23:30:00', 'UTC'));
        $plan = m53Plan($this->vehicle);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/mods/{$plan->id}/install")->assertOk()
            ->assertJsonPath('data.status', 'installed')
            ->assertJsonPath('data.status_label', 'Verbaut')
            ->assertJsonPath('data.installed_on', '2026-12')
            ->assertJsonPath('data.target_month', null)
            ->assertJsonPath('data.priority', null)
            ->assertJsonPath('data.plan_sort', null)
            ->assertJsonPath('data.budget.cents', 120000)
            ->assertJsonPath('data.history_recorded', true);

        $update = BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->sole();
        expect(json_encode($update->getAttributes()))->not->toContain('120000');
    });

    it('takes the month and the final private cost', function () {
        $plan = m53Plan($this->vehicle);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/mods/{$plan->id}/install", ['installed_on' => now()->subMonth()->format('Y-m'), 'cost_cents' => 115000])->assertOk()
            ->assertJsonPath('data.installed_on', now()->subMonth()->format('Y-m'))
            ->assertJsonPath('data.cost.cents', 115000);
    });

    it('validates the month and the cost', function (array $body, string $field) {
        $plan = m53Plan($this->vehicle);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/mods/{$plan->id}/install", $body)->assertUnprocessable()->assertJsonValidationErrorFor($field);

        expect($plan->fresh()?->status)->toBe(ModStatus::Planned);
    })->with([
        'format' => [['installed_on' => '2026-11-03'], 'installed_on'],
        'future' => [fn () => ['installed_on' => now()->addMonths(2)->format('Y-m')], 'installed_on'],
        'cost' => [['cost_cents' => -5], 'cost_cents'],
    ]);

    it('answers 409 mod_not_planned for a mod that is not planned', function () {
        $installed = modIn($this->vehicle, 'exhaust');
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/mods/{$installed->id}/install")->assertStatus(409)
            ->assertJsonPath('code', 'mod_not_planned')
            ->assertJsonPath('message', 'Diese Mod ist nicht mehr geplant. Lade neu, um den aktuellen Stand zu sehen.');
    });

    it('replays with the same Idempotency-Key and answers 409 to a second call without one', function () {
        $plan = m53Plan($this->vehicle);
        Sanctum::actingAs($this->owner);

        $first = $this->withHeader('Idempotency-Key', 'install-1')->postJson("/api/v1/mods/{$plan->id}/install")->assertOk();
        $this->withHeader('Idempotency-Key', 'install-1')->postJson("/api/v1/mods/{$plan->id}/install")->assertOk()
            ->assertHeader('Idempotency-Replayed', 'true')->assertJsonPath('data.installed_on', $first->json('data.installed_on'));

        expect(BuildUpdate::query()->where('vehicle_id', $this->vehicle->id)->count())->toBe(1);

        $this->flushHeaders();
        $this->postJson("/api/v1/mods/{$plan->id}/install")->assertStatus(409)->assertJsonPath('code', 'mod_not_planned');
    });

    it('is rate limited', function () {
        config(['speedclub.rate_limits.garage_edits.max' => 1]);
        RateLimits::register();
        $a = m53Plan($this->vehicle);
        $b = m53Plan($this->vehicle, ['plan_sort' => 2]);
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/mods/{$a->id}/install")->assertOk();
        $this->postJson("/api/v1/mods/{$b->id}/install")->assertTooManyRequests()->assertJsonPath('code', 'rate_limited');
    });

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        $plan = m53Plan($this->vehicle);
        $member = $who($this->owner);

        if ($member !== null) {
            Sanctum::actingAs($member);
        }

        $this->postJson("/api/v1/mods/{$plan->id}/install")->assertStatus($status);

        expect($plan->fresh()?->status)->toBe($status === 200 ? ModStatus::Installed : ModStatus::Planned);
    })->with(ownerOnlyMatrix(200));

    it('refuses a publishing restriction', function () {
        $member = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
        $plan = m53Plan(publishedVehicle($member));
        Sanctum::actingAs($member);

        $this->postJson("/api/v1/mods/{$plan->id}/install")->assertForbidden()->assertJsonPath('code', 'account_restricted');
    });

    it('does not exist for a deleted plan', function () {
        $plan = m53Plan($this->vehicle);
        $plan->delete();
        Sanctum::actingAs($this->owner);

        $this->postJson("/api/v1/mods/{$plan->id}/install")->assertNotFound();
    });
});

describe('PUT vehicles/{id}/plans/order', function () {
    it('orders the plans and leaves the build sheet order and Verlauf alone', function () {
        $a = m53Plan($this->vehicle, ['title' => 'A', 'plan_sort' => 0, 'sort' => 5]);
        $b = m53Plan($this->vehicle, ['title' => 'B', 'plan_sort' => 1, 'sort' => 6]);
        $c = m53Plan($this->vehicle, ['title' => 'C', 'plan_sort' => 2, 'sort' => 7]);
        Sanctum::actingAs($this->owner);

        $response = $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/plans/order", ['ids' => [$c->id, $a->id, $b->id]])->assertOk();

        expect(array_column($response->json('data'), 'id'))->toBe([$c->id, $a->id, $b->id])
            ->and(array_column($response->json('data'), 'plan_sort'))->toBe([0, 1, 2])
            ->and($response->json('data.0.budget.cents'))->toBe(120000)
            ->and($a->fresh()?->sort)->toBe(5)
            ->and(BuildUpdate::query()->count())->toBe(0);

        $page = $this->getJson(m53Page($this->vehicle))->assertOk()->json('data.plans');
        expect(array_column($page['items'], 'id'))->toBe([$c->id, $a->id, $b->id]);
    });

    it('needs every plan exactly once and nothing else', function (Closure $ids) {
        $a = m53Plan($this->vehicle, ['plan_sort' => 0]);
        $b = m53Plan($this->vehicle, ['plan_sort' => 1]);
        $installed = modIn($this->vehicle, 'exhaust');
        Sanctum::actingAs($this->owner);

        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/plans/order", ['ids' => $ids($a, $b, $installed)])
            ->assertUnprocessable()->assertJsonValidationErrorFor('ids');
    })->with([
        'one missing' => [fn (Modification $a, Modification $b, Modification $installed): array => [$a->id]],
        'an installed mod' => [fn (Modification $a, Modification $b, Modification $installed): array => [$a->id, $b->id, $installed->id]],
        'a foreign plan' => [fn (Modification $a, Modification $b, Modification $installed): array => [$a->id, m53Plan(publishedVehicle())->id]],
        'not a list' => [fn (Modification $a, Modification $b, Modification $installed): string => $a->id],
    ]);

    it('applies the authorisation matrix', function (Closure $who, int $status) {
        $a = m53Plan($this->vehicle, ['plan_sort' => 0]);
        $b = m53Plan($this->vehicle, ['plan_sort' => 1]);
        $member = $who($this->owner);

        if ($member !== null) {
            Sanctum::actingAs($member);
        }

        $this->putJson("/api/v1/vehicles/{$this->vehicle->id}/plans/order", ['ids' => [$b->id, $a->id]])->assertStatus($status);
    })->with(ownerOnlyMatrix(200));

    it('refuses a publishing restriction', function () {
        $member = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
        $vehicle = publishedVehicle($member);
        $plan = m53Plan($vehicle);
        Sanctum::actingAs($member);

        $this->putJson("/api/v1/vehicles/{$vehicle->id}/plans/order", ['ids' => [$plan->id]])->assertForbidden()->assertJsonPath('code', 'account_restricted');
    });
});

describe('the vehicle page', function () {
    it('carries the plans in the owner\'s order and the Build-Fortschritt from the rows alone', function () {
        modIn($this->vehicle, 'exhaust', [], ['sort' => 1]);
        modIn($this->vehicle, 'brakes', [], ['sort' => 2]);
        modIn($this->vehicle, 'wheels_tires', [], ['sort' => 3, 'status' => ModStatus::Removed]);
        $late = m53Plan($this->vehicle, ['title' => 'Später', 'plan_sort' => 1, 'priority' => ModPriority::Low]);
        $soon = m53Plan($this->vehicle, ['title' => 'Bald', 'plan_sort' => 0, 'target_month' => Carbon::create(2027, 3, 1)]);

        $page = $this->getJson(m53Page($this->vehicle))->assertOk()->json('data');

        expect($page['plans']['count'])->toBe(2)
            ->and(array_column($page['plans']['items'], 'id'))->toBe([$soon->id, $late->id])
            ->and($page['plans']['items'][0]['target_label'])->toBe('März 2027')
            ->and($page['plans']['items'][1]['priority_label'])->toBe('Niedrig')
            ->and($page['build_progress'])->toBe(['built' => 2, 'planned' => 2, 'total' => 4, 'percent' => 50])
            // Older apps and WEB-01 still read every mod from `mods`.
            ->and($page['mods']['count'])->toBe(5);
    });

    it('rounds down and has no Build-Fortschritt without mods', function () {
        $this->getJson(m53Page($this->vehicle))->assertOk()->assertJsonPath('data.build_progress', null)->assertJsonPath('data.plans.count', 0);

        modIn($this->vehicle, 'exhaust');
        modIn($this->vehicle, 'brakes');
        m53Plan($this->vehicle);

        $this->getJson(m53Page($this->vehicle))->assertJsonPath('data.build_progress', ['built' => 2, 'planned' => 1, 'total' => 3, 'percent' => 66]);
    });

    it('puts plans without an order (written outside the API) after the ordered ones', function () {
        $loose = m53Plan($this->vehicle, ['title' => 'Lose', 'plan_sort' => null, 'sort' => 1]);
        $ordered = m53Plan($this->vehicle, ['title' => 'Sortiert', 'plan_sort' => 0, 'sort' => 2]);

        expect(array_column($this->getJson(m53Page($this->vehicle))->json('data.plans.items'), 'id'))->toBe([$ordered->id, $loose->id]);
    });

    it('shows plans to whoever may see the vehicle and nobody else', function (Closure $who, int $status) {
        m53Plan($this->vehicle);
        $member = $who($this->owner);

        if ($member !== null) {
            Sanctum::actingAs($member);
        }

        $response = $this->getJson(m53Page($this->vehicle))->assertStatus($status);

        if ($status === 200) {
            expect($response->json('data.plans.count'))->toBe(1)->and($response->json('data.build_progress.planned'))->toBe(1);
        } else {
            $response->assertJsonPath('code', 'vehicle_unavailable');
        }
    })->with([
        'guest' => [fn (User $owner): ?User => null, 200],
        'owner' => [fn (User $owner): ?User => $owner, 200],
        'other member' => [fn (User $owner): ?User => User::factory()->create(), 200],
        'restricted member' => [fn (User $owner): ?User => User::factory()->restrictedFrom(RestrictionType::Publishing)->create(), 200],
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
    ]);

    it('keeps the plans of a private vehicle with the owner', function () {
        $private = Vehicle::factory()->private()->create(['owner_id' => $this->owner->id]);
        m53Plan($private);
        Sanctum::actingAs(User::factory()->create());

        $this->getJson(m53Page($private))->assertNotFound()->assertJsonPath('code', 'vehicle_unavailable');
    });
});

describe('the budget never leaves the owner', function () {
    beforeEach(function () {
        // A value that cannot appear by chance: 9.876,54 €.
        $this->plan = m53Plan($this->vehicle, ['budget_cents' => 987654, 'title' => 'Geheimplan']);
        modIn($this->vehicle, 'exhaust', [], ['title' => 'Auspuff']);
        BuildUpdate::factory()->create(['vehicle_id' => $this->vehicle->id]);
    });

    it('is not in any answer for a guest or another member', function (?Closure $who) {
        if ($who !== null) {
            Sanctum::actingAs($who());
        }

        foreach ([m53Page($this->vehicle), m53Page($this->vehicle, "/mods/{$this->plan->id}")] as $url) {
            m53ExpectNoBudget((string) $this->getJson($url)->assertOk()->getContent());
        }

        expect($this->getJson(m53Page($this->vehicle))->json('data.plans.items.0.budget'))->toBeNull()
            ->and($this->getJson(m53Page($this->vehicle, '/updates'))->assertOk()->getContent())->not->toContain('987654');

        if ($who !== null) {
            m53ExpectNoBudget((string) $this->getJson("/api/v1/vehicles/{$this->vehicle->id}/mods")->assertOk()->getContent());
            m53ExpectNoBudget((string) $this->getJson("/api/v1/mods/{$this->plan->id}")->assertOk()->getContent());
        }
    })->with([
        'guest' => [null],
        'other member' => [fn (): User => User::factory()->create()],
    ]);

    it('is not on WEB-01, in its OG tags or JSON-LD', function () {
        $html = (string) $this->get('/v/'.$this->vehicle->canonicalSlug())->assertOk()->getContent();

        expect($html)->not->toContain('987654')->not->toContain('9.876,54')->not->toContain('9,876.54');
    });

    it('is not in compare or search', function () {
        FeatureFlag::query()->updateOrCreate(['key' => 'sig.compare'], ['enabled' => true]);
        $other = publishedVehicle();
        Sanctum::actingAs(User::factory()->create());

        $compare = (string) $this->getJson('/api/v1/compare?'.http_build_query(['a' => $this->vehicle->slug, 'b' => $other->slug]))->assertOk()->getContent();
        expect($compare)->not->toContain('987654')->not->toContain('9.876,54');

        $search = (string) $this->getJson('/api/v1/search/vehicles?sort=newest')->assertOk()->getContent();
        expect($search)->not->toContain('987654')->not->toContain('9.876,54');
    });

    it('is not for staff in view-as, while the owner reads it', function () {
        $this->withoutDefer();
        Mail::fake();
        $token = app(StartViewAs::class)->handle(m31Staff('admin'), $this->owner, m32Reason(), false)['token'];

        foreach ([m53Page($this->vehicle), "/api/v1/vehicles/{$this->vehicle->id}/mods", "/api/v1/mods/{$this->plan->id}"] as $url) {
            m53ExpectNoBudget((string) $this->withToken($token)->getJson($url)->assertOk()->getContent());
        }

        $this->withToken($token)->postJson("/api/v1/mods/{$this->plan->id}/install")->assertForbidden()->assertJsonPath('code', 'view_as_read_only');
        $this->withToken($token)->putJson("/api/v1/vehicles/{$this->vehicle->id}/plans/order", ['ids' => [$this->plan->id]])
            ->assertForbidden()->assertJsonPath('code', 'view_as_read_only');

        $this->flushHeaders();
        $this->app['auth']->forgetGuards();
        Sanctum::actingAs($this->owner);

        $this->withHeader('Accept-Language', 'de')->getJson(m53Page($this->vehicle))->assertJsonPath('data.plans.items.0.budget.cents', 987654)
            ->assertJsonPath('data.plans.items.0.budget.label', 'Budget 9.876,54 €');
    });

    it('is in the owner\'s own data export with the plan', function () {
        $vehicles = app(ExportContents::class)->documents($this->owner)['vehicles.json'];
        $mods = collect($vehicles)->firstWhere('id', $this->vehicle->id)['modifications'] ?? [];
        $row = collect($mods)->firstWhere('id', $this->plan->id);

        expect($row)->not->toBeNull()
            ->and($row['budget_cents'])->toBe(987654)
            ->and($row['priority'])->toBe('normal')
            ->and($row['plan_sort'])->toBe(1)
            ->and($row['target_month'])->toStartWith($this->plan->target_month?->format('Y-m'));
    });
});
