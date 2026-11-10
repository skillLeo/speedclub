<?php

use App\Enums\AiFeature;
use App\Enums\TranslationSource;
use App\Models\FeatureFlag;
use App\Models\Media;
use App\Models\Vehicle;
use App\Services\Ai\Agents\DescriptionAgent;
use App\Services\Ai\Agents\ModSuggestAgent;
use App\Services\Ai\Agents\PhotoCategoryAgent;
use App\Services\Ai\Agents\SearchInterpreterAgent;
use App\Services\Ai\Agents\TranslateAgent;
use App\Services\Ai\AiGateway;
use Database\Seeders\FeatureFlagSeeder;

require_once __DIR__.'/AiTestHelpers.php';

/**
 * m3.7 §3: flag off → 404, no provider → 404, guest → 401, no opt-in → 403 ai_opt_in_required (not for the translation).
 */
beforeEach(function () {
    $this->withHeader('Accept-Language', 'de');
    $this->owner = aiMember();
    $this->vehicle = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id, 'description' => 'Tief und laut.']);
    $this->photo = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id]);

    foreach ([SearchInterpreterAgent::class, ModSuggestAgent::class, PhotoCategoryAgent::class, TranslateAgent::class, DescriptionAgent::class] as $agent) {
        $agent::fake()->preventStrayPrompts();
    }
});

/**
 * @return array<string, array{0: string, 1: Closure(object): array{0: string, 1: array<string, mixed>}}>
 */
function aiEndpoints(): array
{
    return [
        'nl_search' => [AiFeature::NlSearch->value, fn (object $t): array => ['/api/v1/ai/search/interpret', ['q' => 'schwarzer M4']]],
        'mod_assist' => [AiFeature::ModAssist->value, fn (object $t): array => ['/api/v1/ai/mods/suggest', ['text' => 'KW V3 Gewindefahrwerk']]],
        'photo_tagging' => [AiFeature::PhotoTagging->value, fn (object $t): array => ['/api/v1/ai/photos/'.$t->photo->id.'/category', []]],
        'translate' => [AiFeature::Translate->value, fn (object $t): array => ['/api/v1/ai/translate', ['source' => TranslationSource::VehicleDescription->value, 'id' => $t->vehicle->id, 'to' => 'en']]],
        'description_assist' => [AiFeature::DescriptionAssist->value, fn (object $t): array => ['/api/v1/ai/vehicles/'.$t->vehicle->id.'/description', []]],
    ];
}

it('answers 404 feature_disabled while the flag is off, without calling a provider', function (string $feature, Closure $endpoint) {
    aiProvider();
    aiActAs($this->owner);
    [$url, $body] = $endpoint($this);

    $this->postJson($url, $body)->assertNotFound()->assertJsonPath('code', 'feature_disabled');
    expect(aiCallLog())->toBe('[]');
})->with(aiEndpoints());

it('answers 404 feature_disabled while no provider key exists, even with the flag on (OA-18)', function (string $feature, Closure $endpoint) {
    aiOn();
    aiProvider(false);
    aiActAs($this->owner);
    [$url, $body] = $endpoint($this);

    expect(app(AiGateway::class)->available())->toBeFalse();
    $this->postJson($url, $body)->assertNotFound()->assertJsonPath('code', 'feature_disabled');

    config(['speedclub.services.ai_provider' => 'anthropic']);
    $this->postJson($url, $body)->assertNotFound()->assertJsonPath('code', 'feature_disabled');
})->with(aiEndpoints());

it('needs a signed-in member', function (string $feature, Closure $endpoint) {
    aiOn();
    [$url, $body] = $endpoint($this);

    $this->postJson($url, $body)->assertUnauthorized();
})->with(aiEndpoints());

it('needs the opt-in for every suggestion feature, but not for the translation', function (string $feature, Closure $endpoint) {
    aiOn();
    $this->owner->forceFill(['ai_suggestions' => false])->save();
    aiActAs($this->owner);
    TranslateAgent::fake([['refused' => false, 'text' => 'Low and loud.']]);
    [$url, $body] = $endpoint($this);

    $response = $this->postJson($url, $body);

    if ($feature === AiFeature::Translate->value) {
        $response->assertOk();
    } else {
        $response->assertForbidden()->assertJsonPath('code', 'ai_opt_in_required')
            ->assertJsonPath('message', __('errors.ai_opt_in_required', [], 'de'));
    }
})->with(aiEndpoints());

it('keeps every ai.* flag off in the seeded flag table', function () {
    $this->seed(FeatureFlagSeeder::class);

    foreach (AiFeature::cases() as $feature) {
        if ($feature === AiFeature::ConnectivityTest) {
            continue;
        }

        expect(FeatureFlag::query()->where('key', $feature->flag())->value('enabled'))->toBeFalse($feature->flag());
    }
});

it('limits the suggestions to 30 an hour and the translations to 60 an hour per member', function () {
    aiOn();
    $member = aiActAs(aiMember());
    SearchInterpreterAgent::fake(fn () => ['refused' => false, 'chips' => []]);
    TranslateAgent::fake(fn () => ['refused' => false, 'text' => 'Low and loud.']);

    foreach (range(1, 30) as $i) {
        $this->postJson('/api/v1/ai/search/interpret', ['q' => 'schwarzer M4'])->assertOk();
    }
    $this->postJson('/api/v1/ai/search/interpret', ['q' => 'schwarzer M4'])->assertStatus(429)->assertJsonPath('code', 'rate_limited');

    foreach (range(1, 60) as $i) {
        $this->postJson('/api/v1/ai/translate', ['source' => 'vehicle_description', 'id' => $this->vehicle->id, 'to' => 'en'])->assertOk();
    }
    $this->postJson('/api/v1/ai/translate', ['source' => 'vehicle_description', 'id' => $this->vehicle->id, 'to' => 'en'])->assertStatus(429);

    // Another member has their own budget.
    aiActAs(aiMember());
    $this->postJson('/api/v1/ai/search/interpret', ['q' => 'schwarzer M4'])->assertOk();
    expect($member->id)->not->toBeEmpty();
});

it('validates the input', function () {
    aiOn();
    aiActAs($this->owner);

    $this->postJson('/api/v1/ai/search/interpret', ['q' => str_repeat('a', 201)])->assertUnprocessable()->assertJsonValidationErrors('q');
    $this->postJson('/api/v1/ai/mods/suggest', ['text' => str_repeat('a', 501)])->assertUnprocessable()->assertJsonValidationErrors('text');
    $this->postJson('/api/v1/ai/translate', ['source' => 'profile', 'id' => 'x', 'to' => 'fr'])->assertUnprocessable()->assertJsonValidationErrors(['source', 'id', 'to']);
});
