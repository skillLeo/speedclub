<?php

use App\Enums\ModFieldType;
use App\Enums\RestrictionType;
use App\Http\RateLimits;
use App\Models\Block;
use App\Models\Brand;
use App\Models\CatalogRequest;
use App\Models\Generation;
use App\Models\Make;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use Database\Seeders\ModCategorySeeder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;

it('lists active makes, popular first, with the shape and an ETag', function () {
    $plain = Make::factory()->create(['name' => 'Aston Martin', 'is_popular' => false, 'active' => true]);
    $popular = Make::factory()->create(['name' => 'Zastava', 'is_popular' => true, 'active' => true]);
    Make::factory()->create(['active' => false]);

    $response = $this->getJson('/api/v1/catalog/makes')
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.id', $popular->id)
        ->assertJsonPath('data.1.id', $plain->id)
        ->assertJsonStructure([
            'data' => ['*' => ['id', 'name', 'slug', 'country', 'is_popular']],
            'meta' => ['per_page', 'next_cursor', 'prev_cursor'],
            'links',
        ])
        ->assertHeader('ETag');

    $this->withHeader('If-None-Match', $response->headers->get('ETag'))
        ->getJson('/api/v1/catalog/makes')
        ->assertStatus(304)
        ->assertNoContent(304);
});

it('answers forged cursors with 422 instead of a logged server error', function (mixed $payload) {
    Log::spy();

    $cursor = is_string($payload) ? $payload : rtrim(strtr(base64_encode((string) json_encode($payload)), '+/', '-_'), '=');

    foreach (['makes', 'brands', 'mod-categories'] as $list) {
        $this->getJson("/api/v1/catalog/$list?cursor=$cursor")
            ->assertUnprocessable()
            ->assertJsonPath('code', 'validation_failed')
            ->assertJsonValidationErrors('cursor');
    }

    Log::shouldNotHaveReceived('error');
})->with([
    'no base64' => ['!!!'],
    'no flag' => [['name' => 'a', 'id' => 1]],
    'empty object' => [new stdClass],
    'a number' => [1],
    'missing columns' => [['_pointsToNextItems' => true]],
    'extra column' => [['_pointsToNextItems' => true, 'password' => 'x', 'id' => 1, 'name' => 'a', 'sort' => 1, 'is_popular' => 1]],
    'array value' => [['_pointsToNextItems' => true, 'id' => [1], 'name' => ['a'], 'sort' => [1], 'is_popular' => [1]]],
]);

it('accepts the cursors it hands out on every list', function (string $uri, string $factory, array $attributes) {
    $factory::factory()->count(3)->create($attributes);

    $cursor = $this->getJson("$uri?per_page=1")->assertOk()->json('meta.next_cursor');

    expect($cursor)->toBeString();

    $this->getJson("$uri?per_page=1&cursor=$cursor")->assertOk();
})->with([
    'makes' => ['/api/v1/catalog/makes', Make::class, ['active' => true]],
    'brands' => ['/api/v1/catalog/brands', Brand::class, []],
    'mod categories' => ['/api/v1/catalog/mod-categories', ModCategory::class, ['active' => true]],
]);

it('accepts the cursors of models and generations', function () {
    $make = Make::factory()->create(['active' => true]);
    $models = VehicleModel::factory()->count(2)->create(['make_id' => $make->id, 'active' => true]);
    Generation::factory()->count(2)->create(['model_id' => $models[0]->id]);

    foreach (["/api/v1/catalog/makes/{$make->id}/models", "/api/v1/catalog/models/{$models[0]->id}/generations"] as $uri) {
        $cursor = $this->getJson("$uri?per_page=1")->assertOk()->json('meta.next_cursor');

        expect($cursor)->toBeString();

        $this->getJson("$uri?per_page=1&cursor=$cursor")->assertOk();
    }
});

it('limits public reads per IP with a friendly 429', function () {
    foreach (['catalog/makes', 'catalog/brands', 'catalog/mod-categories', 'catalog/makes/1/models', 'catalog/models/1/generations', 'app-config', 'legal/imprint'] as $path) {
        $route = Route::getRoutes()->match(Request::create("/api/v1/$path"));

        expect($route->middleware())->toContain('throttle:public-read');
    }

    $key = RateLimiter::limiter('public-read')(Request::create('/', 'GET', server: ['REMOTE_ADDR' => '127.0.0.1']));

    foreach (range(1, $key->maxAttempts) as $attempt) {
        RateLimiter::hit(md5('public-read'.$key->key), $key->decaySeconds);
    }

    $this->getJson('/api/v1/catalog/makes', ['Accept-Language' => 'de'])
        ->assertTooManyRequests()
        ->assertHeader('Retry-After')
        ->assertJsonPath('code', 'rate_limited')
        ->assertJsonPath('message', fn (string $message): bool => str_starts_with($message, 'Zu viele Anfragen.'));
});

it('paginates with a cursor', function () {
    Make::factory()->count(3)->create(['active' => true]);

    $first = $this->getJson('/api/v1/catalog/makes?per_page=2')->assertOk()->assertJsonCount(2, 'data');
    $cursor = $first->json('meta.next_cursor');

    expect($cursor)->toBeString();

    $this->getJson('/api/v1/catalog/makes?per_page=2&cursor='.$cursor)
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('meta.next_cursor', null);
});

it('validates the page size', function (int $size) {
    $this->getJson("/api/v1/catalog/makes?per_page=$size")->assertUnprocessable()->assertJsonValidationErrors('per_page');
})->with([0, 501]);

it('lists the active models of a make', function () {
    $make = Make::factory()->create();
    $model = VehicleModel::factory()->create(['make_id' => $make->id, 'active' => true]);
    VehicleModel::factory()->create(['make_id' => $make->id, 'active' => false]);
    VehicleModel::factory()->create(['active' => true]);

    $this->getJson("/api/v1/catalog/makes/{$make->id}/models")
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertExactJson([
            'data' => [['id' => $model->id, 'make_id' => $make->id, 'name' => $model->name, 'slug' => $model->slug]],
            'links' => ['first' => null, 'last' => null, 'prev' => null, 'next' => null],
            'meta' => [
                'path' => url("/api/v1/catalog/makes/{$make->id}/models"),
                'per_page' => 200,
                'next_cursor' => null,
                'prev_cursor' => null,
            ],
        ])
        ->assertHeader('ETag');
});

it('answers 404 for an unknown or inactive make', function () {
    $this->getJson('/api/v1/catalog/makes/999999/models')->assertNotFound()->assertJsonPath('code', 'not_found');
    $this->getJson('/api/v1/catalog/makes/not-a-number/models')->assertNotFound();

    $inactive = Make::factory()->create(['active' => false]);
    $this->getJson("/api/v1/catalog/makes/{$inactive->id}/models")->assertNotFound();
});

it('lists the generations of a model', function () {
    $model = VehicleModel::factory()->create(['active' => true]);
    $generation = Generation::factory()->create(['model_id' => $model->id, 'year_from' => 2014, 'year_to' => 2020]);
    Generation::factory()->create();

    $this->getJson("/api/v1/catalog/models/{$model->id}/generations")
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0', [
            'id' => $generation->id,
            'model_id' => $model->id,
            'name' => $generation->name,
            'slug' => $generation->slug,
            'year_from' => 2014,
            'year_to' => 2020,
        ])
        ->assertHeader('ETag');
});

it('answers 404 for an unknown or inactive model', function () {
    $this->getJson('/api/v1/catalog/models/999999/generations')->assertNotFound();

    $inactive = VehicleModel::factory()->create(['active' => false]);
    $this->getJson("/api/v1/catalog/models/{$inactive->id}/generations")->assertNotFound();
});

it('lists brands, filtered by category and without merged ones', function () {
    $kw = Brand::factory()->create(['name' => 'KW', 'category_hint' => 'suspension', 'aliases' => ['KW automotive']]);
    Brand::factory()->create(['name' => 'Akrapovic', 'category_hint' => 'exhaust']);
    Brand::factory()->create(['name' => 'K-W', 'category_hint' => 'suspension', 'merged_into_id' => $kw->id]);

    $this->getJson('/api/v1/catalog/brands')->assertOk()->assertJsonCount(2, 'data')->assertHeader('ETag');

    $this->getJson('/api/v1/catalog/brands?category=suspension')
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0', [
            'id' => $kw->id,
            'name' => 'KW',
            'slug' => $kw->slug,
            'category_hint' => 'suspension',
            'aliases' => ['KW automotive'],
        ]);

    $this->getJson('/api/v1/catalog/brands?category='.str_repeat('x', 41))->assertUnprocessable();
});

it('lists mod categories with field schemas in the language of the request', function (string $locale, string $name, string $label, string $option) {
    $category = ModCategory::factory()->create(['key' => 'suspension', 'name' => ['de' => 'Fahrwerk', 'en' => 'Suspension'], 'active' => true]);
    ModCategoryField::factory()->create([
        'category_id' => $category->id,
        'key' => 'type',
        'label' => ['de' => 'Art', 'en' => 'Type'],
        'type' => ModFieldType::Select,
        'unit' => null,
        'options' => [['value' => 'coilover', 'label' => ['de' => 'Gewindefahrwerk', 'en' => 'Coilover']], 'Serie'],
        'required' => true,
        'searchable' => true,
        'facet' => true,
    ]);
    ModCategory::factory()->create(['active' => false]);

    $this->withHeader('Accept-Language', $locale)
        ->getJson('/api/v1/catalog/mod-categories')
        ->assertOk()
        ->assertHeader('ETag')
        ->assertHeader('Content-Language', $locale)
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.key', 'suspension')
        ->assertJsonPath('data.0.name', $name)
        ->assertJsonPath('data.0.fields.0.label', $label)
        ->assertJsonPath('data.0.fields.0.type', 'select')
        ->assertJsonPath('data.0.fields.0.options.0', ['value' => 'coilover', 'label' => $option])
        ->assertJsonPath('data.0.fields.0.options.1', ['value' => 'Serie', 'label' => 'Serie'])
        ->assertJsonPath('data.0.fields.0.required', true)
        ->assertJsonStructure(['data' => ['*' => [
            'id', 'key', 'name', 'icon',
            'fields' => ['*' => ['key', 'label', 'type', 'unit', 'min', 'max', 'step', 'options', 'pattern', 'example', 'required', 'searchable', 'facet']],
        ]]]);
})->with([
    'de' => ['de', 'Fahrwerk', 'Art', 'Gewindefahrwerk'],
    'en' => ['en', 'Suspension', 'Type', 'Coilover'],
]);

it('serves the seeded schema: options only on selects, pattern and example on text fields', function () {
    $this->seed(ModCategorySeeder::class);

    $fields = collect($this->withHeader('Accept-Language', 'de')->getJson('/api/v1/catalog/mod-categories')->assertOk()->json('data'))
        ->firstWhere('key', 'wheels_tires')['fields'];
    $field = fn (string $key): array => collect($fields)->firstWhere('key', $key);

    expect($field('tyre_size_front'))->toMatchArray(['type' => 'text', 'options' => null, 'pattern' => '^\d{3}/\d{2} R\d{2}$', 'example' => '255/35 R19'])
        ->and($field('bolt_pattern'))->toMatchArray(['type' => 'text', 'options' => null, 'pattern' => null, 'example' => '5×120'])
        ->and($field('diameter'))->toMatchArray(['type' => 'number', 'options' => null, 'pattern' => null, 'example' => null]);

    $suspension = collect($this->getJson('/api/v1/catalog/mod-categories')->json('data'))->firstWhere('key', 'suspension');

    expect($suspension['fields'][0]['options'][0])->toBe(['value' => 'coilover', 'label' => 'Gewindefahrwerk'])
        ->and($suspension['fields'][0]['pattern'])->toBeNull();
});

it('gives each language its own ETag', function () {
    ModCategory::factory()->create(['name' => ['de' => 'Fahrwerk', 'en' => 'Suspension'], 'active' => true]);

    $de = $this->withHeader('Accept-Language', 'de')->getJson('/api/v1/catalog/mod-categories');
    $en = $this->withHeader('Accept-Language', 'en')->getJson('/api/v1/catalog/mod-categories');

    expect($de->headers->get('ETag'))->not->toBe($en->headers->get('ETag'));
});

describe('POST catalog/requests', function () {
    it('needs a signed-in member', function () {
        $this->postJson('/api/v1/catalog/requests', ['make_text' => 'Lada'])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'unauthenticated');
    });

    it('does not let a staff session in', function (string $cookie) {
        $session = databaseSessionFor(Staff::factory()->create(), 'staff');

        $this->withCredentials()
            ->withCookie($cookie === 'default' ? config()->string('session.cookie') : $cookie, $session)
            ->withHeaders(['Origin' => 'http://localhost:8080', 'Accept' => 'application/json'])
            ->postJson('/api/v1/catalog/requests', ['make_text' => 'Lada'])
            ->assertUnauthorized()
            ->assertJsonPath('code', 'unauthenticated');

        expect(CatalogRequest::query()->count())->toBe(0);
    })->with(['default', 'sc_staff_session']);

    it('does not take a vehicle of someone in a block with the member, in either direction', function (bool $memberIsBlocker) {
        $member = User::factory()->create();
        $owner = User::factory()->create();
        $vehicle = Vehicle::factory()->for($owner, 'owner')->create();
        Block::factory()->create(['blocker_id' => $memberIsBlocker ? $member->id : $owner->id, 'blocked_id' => $memberIsBlocker ? $owner->id : $member->id]);
        Sanctum::actingAs($member);

        $this->postJson('/api/v1/catalog/requests', ['make_text' => 'Lada', 'vehicle_id' => $vehicle->id])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('vehicle_id');
    })->with(['member blocked the owner' => [true], 'owner blocked the member' => [false]]);

    it('stores a request of the member with the shape', function () {
        $member = User::factory()->create();
        $vehicle = Vehicle::factory()->for($member, 'owner')->create();
        Sanctum::actingAs($member);

        $this->postJson('/api/v1/catalog/requests', [
            'make_text' => 'Lada',
            'model_text' => 'Niva',
            'generation_text' => '2121',
            'vehicle_id' => $vehicle->id,
        ])
            ->assertCreated()
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.make_text', 'Lada')
            ->assertExactJsonStructure(['data' => ['id', 'status', 'vehicle_id', 'make_text', 'model_text', 'generation_text', 'created_at']]);

        expect(CatalogRequest::query()->sole()->user_id)->toBe($member->id);
    });

    it('validates its input', function (array $payload, string $field) {
        Sanctum::actingAs(User::factory()->create());

        $this->postJson('/api/v1/catalog/requests', $payload)->assertUnprocessable()->assertJsonValidationErrors($field);
    })->with([
        'no make' => [['model_text' => 'x'], 'make_text'],
        'long make' => [['make_text' => str_repeat('x', 101)], 'make_text'],
        'not a ulid' => [['make_text' => 'x', 'vehicle_id' => 'nope'], 'vehicle_id'],
    ]);

    it('does not accept the vehicle of another member', function () {
        Sanctum::actingAs(User::factory()->create());
        $foreign = Vehicle::factory()->create();

        $this->postJson('/api/v1/catalog/requests', ['make_text' => 'x', 'vehicle_id' => $foreign->id])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('vehicle_id');
    });

    it('refuses a restricted member', function () {
        Sanctum::actingAs(User::factory()->restrictedFrom(RestrictionType::Publishing)->create());

        $this->postJson('/api/v1/catalog/requests', ['make_text' => 'x'])
            ->assertForbidden()
            ->assertJsonPath('code', 'account_restricted');
    });

    it('refuses a deactivated member', function () {
        Sanctum::actingAs(User::factory()->deactivated()->create());

        $this->postJson('/api/v1/catalog/requests', ['make_text' => 'x'])->assertForbidden();
    });

    it('replays with an Idempotency-Key', function () {
        Sanctum::actingAs(User::factory()->create());
        $headers = ['Idempotency-Key' => 'request-1'];

        $first = $this->postJson('/api/v1/catalog/requests', ['make_text' => 'Lada'], $headers)->assertCreated();
        $second = $this->postJson('/api/v1/catalog/requests', ['make_text' => 'Lada'], $headers)->assertCreated();

        expect($second->json('data.id'))->toBe($first->json('data.id'))
            ->and(CatalogRequest::query()->count())->toBe(1);
    });

    it('is rate limited per member', function () {
        config(['speedclub.rate_limits.catalog_requests.max' => 1]);
        RateLimits::register();
        Sanctum::actingAs(User::factory()->create());

        $this->postJson('/api/v1/catalog/requests', ['make_text' => 'a'])->assertCreated();
        $this->postJson('/api/v1/catalog/requests', ['make_text' => 'b'])
            ->assertTooManyRequests()
            ->assertHeader('Retry-After')
            ->assertJsonPath('code', 'rate_limited');

        Sanctum::actingAs(User::factory()->create());
        $this->postJson('/api/v1/catalog/requests', ['make_text' => 'c'])->assertCreated();
    });
});
