<?php

use App\Enums\AiFeature;
use App\Enums\PowerSource;
use App\Models\AiCall;
use App\Models\AiSpecSuggestion;
use App\Models\Block;
use App\Models\FeatureFlag;
use App\Models\Generation;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Services\Ai\Agents\SpecSuggestionAgent;
use App\Services\Ai\AiGateway;
use Illuminate\Testing\TestResponse;
use Laravel\Ai\Prompts\AgentPrompt;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/AiTestHelpers.php';

/**
 * M5.9 "Daten übernehmen?" (10 §8.1, m5.9-contract §2.1, lead D-1): typical factory specs per catalogue generation, shared by every member
 * (no member data in the prompt or the cache), only valid spec values, the member confirms; the taken values carry "Herstellerangabe
 * (KI-Vorschlag)" until changed.
 */
beforeEach(function () {
    aiOn(AiFeature::VehicleSpecs);
    $this->generation = Generation::factory()->create(['name' => 'E46', 'year_from' => 1998, 'year_to' => 2006]);
});

function specsAnswer(array $variant = []): array
{
    return ['refused' => false, 'variants' => [[
        'label' => '330Ci (M54B30)', 'engine_code' => 'M54B30', 'displacement_cc' => 2979, 'fuel' => 'petrol', 'aspiration' => 'naturally_aspirated',
        'power_value' => 231, 'power_unit' => 'ps', 'torque_nm' => 300, 'drivetrain' => 'rear', 'gearbox' => 'manual', ...$variant,
    ]]];
}

function specsAsk(User $member, array $body): TestResponse
{
    aiActAs($member);

    return test()->postJson('/api/v1/ai/specs/suggest', $body, ['Accept-Language' => 'de']);
}

it('suggests typical factory specs from catalogue names only and labels them', function () {
    SpecSuggestionAgent::fake([specsAnswer()]);
    $member = aiMember(attributes: ['username' => 'max.e46', 'display_name' => 'Max Mustermann']);

    $data = specsAsk($member, ['generation_id' => $this->generation->id])->assertOk()->json('data');

    expect($data['label'])->toBe('KI-Vorschlag')
        ->and($data['provenance_label'])->toBe("Herstellerangabe (KI-\u{2060}Vorschlag)")
        ->and($data['subject'])->toContain('E46')->toContain('(1998–2006)')
        ->and($data['cached'])->toBeFalse()
        ->and($data['variants'][0]['key'])->toBe('330ci-m54b30')
        ->and($data['variants'][0]['fields'])->toBe(['engine_code' => 'M54B30', 'displacement_cc' => 2979, 'fuel' => 'petrol', 'aspiration' => 'naturally_aspirated', 'power_value' => 231, 'power_unit' => 'ps', 'torque_nm' => 300, 'drivetrain' => 'rear', 'gearbox' => 'manual']);

    SpecSuggestionAgent::assertPrompted(fn (AgentPrompt $prompt): bool => $prompt->contains('E46') && ! $prompt->contains('max.e46') && ! $prompt->contains('Mustermann'));
    expect(json_encode(AiSpecSuggestion::query()->sole()->toArray()))->not->toContain($member->id)->not->toContain('max.e46');
});

it('serves every member from the shared cache: no provider call and no daily share spent', function () {
    SpecSuggestionAgent::fake([specsAnswer()]);
    specsAsk(aiMember(), ['generation_id' => $this->generation->id])->assertOk();
    $calls = AiCall::query()->count();

    $other = aiMember();
    specsAsk($other, ['generation_id' => $this->generation->id])->assertOk()->assertJsonPath('data.cached', true);

    SpecSuggestionAgent::assertPromptedTimes(1);
    expect(AiCall::query()->count())->toBe($calls)
        ->and(app(AiGateway::class)->usedTodayBy(AiFeature::VehicleSpecs, $other))->toBe(0);
});

it('asks again once the cached suggestion expired', function () {
    SpecSuggestionAgent::fake([specsAnswer(), specsAnswer(['power_value' => 230])]);
    specsAsk(aiMember(), ['generation_id' => $this->generation->id])->assertOk();
    AiSpecSuggestion::query()->update(['expires_at' => now()->subMinute()]);

    specsAsk(aiMember(), ['generation_id' => $this->generation->id])->assertOk()->assertJsonPath('data.variants.0.fields.power_value', 230);
    expect(AiSpecSuggestion::query()->count())->toBe(1);
});

it('keeps only values the spec form accepts, power only with its unit', function () {
    SpecSuggestionAgent::fake([specsAnswer(['fuel' => 'steam', 'displacement_cc' => 999999, 'power_unit' => null, 'gearbox' => 'automatic_dct_x'])]);

    $fields = specsAsk(aiMember(), ['generation_id' => $this->generation->id])->assertOk()->json('data.variants.0.fields');

    expect($fields)->toBe(['engine_code' => 'M54B30', 'aspiration' => 'naturally_aspirated', 'torque_nm' => 300, 'drivetrain' => 'rear']);
});

it('answers 422 ai_unverifiable when no variant keeps a valid value, and stores nothing', function () {
    SpecSuggestionAgent::fake([['refused' => false, 'variants' => [['label' => 'X', 'engine_code' => null, 'displacement_cc' => null, 'fuel' => 'steam', 'aspiration' => null, 'power_value' => null, 'power_unit' => null, 'torque_nm' => null, 'drivetrain' => null, 'gearbox' => null]]]]);

    specsAsk(aiMember(), ['generation_id' => $this->generation->id])->assertUnprocessable()->assertJsonPath('code', 'ai_unverifiable');
    expect(AiSpecSuggestion::query()->count())->toBe(0);
});

it('validates the subject', function (Closure $body, string $field) {
    SpecSuggestionAgent::fake()->preventStrayPrompts();

    specsAsk(aiMember(), $body($this->generation))->assertUnprocessable()->assertJsonValidationErrors($field);
})->with([
    'nothing' => [fn (): array => [], 'generation_id'],
    'unknown generation' => [fn (): array => ['generation_id' => 999999], 'generation_id'],
    'inactive generation' => [function (Generation $generation): array {
        $generation->forceFill(['active' => false])->save();

        return ['generation_id' => $generation->id];
    }, 'generation_id'],
    'model with generations' => [fn (Generation $generation): array => ['model_id' => $generation->model_id, 'model_year' => 2001], 'generation_id'],
    'model without year' => [fn (Generation $generation): array => ['model_id' => $generation->model_id], 'model_year'],
]);

it('takes a model and year when the model has no generations', function () {
    SpecSuggestionAgent::fake([specsAnswer()]);
    $model = VehicleModel::factory()->create(['name' => 'Roadster']);

    specsAsk(aiMember(), ['model_id' => $model->id, 'model_year' => 2004])->assertOk()->assertJsonPath('data.subject', fn (string $subject): bool => str_contains($subject, 'Roadster (2004)'));
});

describe('who may ask', function () {
    it('needs the opt-in, a verified address and the flag; staff in view-as may not', function (Closure $setup, int $status, string $code) {
        SpecSuggestionAgent::fake()->preventStrayPrompts();
        [$member, $headers] = $setup($this);

        if ($member instanceof User) {
            Sanctum::actingAs($member);
        }

        $this->postJson('/api/v1/ai/specs/suggest', ['generation_id' => $this->generation->id], $headers)->assertStatus($status)->assertJsonPath('code', $code);
    })->with([
        'guest' => [fn (): array => [null, []], 401, 'unauthenticated'],
        'opt-in off' => [fn (): array => [aiMember(false), []], 403, 'ai_opt_in_required'],
        'unverified' => [fn (): array => [aiMember(attributes: ['email_verified_at' => null]), []], 403, 'email_not_verified'],
        'flag off' => [function (): array {
            FeatureFlag::query()->where('key', 'ai.vehicle_specs')->update(['enabled' => false]);

            return [aiMember(), []];
        }, 404, 'feature_disabled'],
        'no provider key' => [function (): array {
            aiProvider(false);

            return [aiMember(), []];
        }, 404, 'feature_disabled'],
    ]);

    it('is limited per member and per day, and answers 503 when the provider fails', function () {
        $member = aiMember();
        config(['speedclub.ai.member_daily_min' => 1, 'speedclub.ai.member_daily_share' => 0.0]);
        SpecSuggestionAgent::fake([specsAnswer()]);
        specsAsk($member, ['generation_id' => $this->generation->id])->assertOk();

        $other = Generation::factory()->create();
        specsAsk($member, ['generation_id' => $other->id])->assertStatus(429)->assertJsonPath('code', 'ai_daily_limit');

        SpecSuggestionAgent::fake(fn () => throw new RuntimeException('provider down'));
        specsAsk(aiMember(), ['generation_id' => $other->id])->assertStatus(503)->assertJsonPath('code', 'ai_unavailable');

        config(['speedclub.ai.daily_calls.vehicle_specs' => 0]);
        specsAsk(aiMember(), ['generation_id' => $other->id])->assertStatus(503)->assertJsonPath('code', 'ai_budget_exhausted');
    });
});

describe('taking the values over', function () {
    beforeEach(function () {
        SpecSuggestionAgent::fake([specsAnswer()]);
        $this->owner = aiMember();
        $this->car = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id, 'generation_id' => $this->generation->id]);
        $this->cacheId = specsAsk($this->owner, ['generation_id' => $this->generation->id])->json('data.cache_id');
        $this->values = ['engine_code' => 'M54B30', 'displacement_cc' => 2979, 'fuel' => 'petrol', 'power_value' => 231, 'power_unit' => 'ps', 'power_source' => 'factory', 'torque_nm' => 300, 'torque_source' => 'factory', 'drivetrain' => 'rear'];
    });

    it('marks the taken values as "Herstellerangabe (KI-Vorschlag)" until the member changes them', function () {
        aiActAs($this->owner);
        $this->putJson("/api/v1/vehicles/{$this->car->id}/specs", [...$this->values, 'ai_suggestion' => ['cache_id' => $this->cacheId, 'variant' => '330ci-m54b30']], ['Accept-Language' => 'de'])->assertOk();

        expect($this->car->refresh()->specs?->getAttribute('ai_fields'))->toHaveKeys(['engine_code', 'displacement_cc', 'fuel', 'power_value', 'power_unit', 'torque_nm', 'drivetrain']);
        $this->getJson("/api/v1/vehicles/{$this->car->id}")->assertJsonPath('data.specs.ai_fields', fn (array $fields): bool => in_array('power_value', $fields, true));
        $page = $this->getJson('/api/v1/public/vehicles/'.$this->car->canonicalSlug(), ['Accept-Language' => 'de'])->json('data');
        expect($page['power']['source_label'])->toBe("Herstellerangabe (KI-\u{2060}Vorschlag)")
            ->and($page['torque']['source_label'])->toBe("Herstellerangabe (KI-\u{2060}Vorschlag)");

        // The owner's own dyno figure and another engine code: those lose the mark, the rest keeps it.
        $this->putJson("/api/v1/vehicles/{$this->car->id}/specs", [...$this->values, 'engine_code' => 'S54B32', 'power_value' => 260, 'power_source' => PowerSource::Measured->value])->assertOk();
        $fields = array_keys($this->car->refresh()->specs?->getAttribute('ai_fields') ?? []);
        expect($fields)->not->toContain('engine_code', 'power_value', 'power_unit')->toContain('torque_nm', 'fuel');
        expect($this->getJson('/api/v1/public/vehicles/'.$this->car->canonicalSlug(), ['Accept-Language' => 'de'])->json('data.power.source_label'))->toBe('Prüfstand');
    });

    it('refuses an unknown or expired suggestion with 422, and ignores it while the flag is off', function () {
        aiActAs($this->owner);
        $this->putJson("/api/v1/vehicles/{$this->car->id}/specs", [...$this->values, 'ai_suggestion' => ['cache_id' => '01JAAAAAAAAAAAAAAAAAAAAAAA', 'variant' => '330ci-m54b30']])
            ->assertUnprocessable()->assertJsonValidationErrors('ai_suggestion');

        FeatureFlag::query()->where('key', 'ai.vehicle_specs')->update(['enabled' => false]);
        $this->putJson("/api/v1/vehicles/{$this->car->id}/specs", [...$this->values, 'ai_suggestion' => ['cache_id' => '01JAAAAAAAAAAAAAAAAAAAAAAA', 'variant' => 'x']])->assertOk();
        expect($this->car->refresh()->specs?->getAttribute('ai_fields'))->toBeNull();
    });

    it('keeps the owner-only rules of PUT specs: other member 403, blocked 403, guest 401', function () {
        $other = aiMember();
        Block::factory()->create(['blocker_id' => $this->owner->id, 'blocked_id' => $other->id]);
        aiActAs($other);
        $this->putJson("/api/v1/vehicles/{$this->car->id}/specs", [...$this->values, 'ai_suggestion' => ['cache_id' => $this->cacheId, 'variant' => '330ci-m54b30']])->assertForbidden();

        app('auth')->forgetGuards();
        $this->putJson("/api/v1/vehicles/{$this->car->id}/specs", $this->values)->assertUnauthorized();
    });
});
