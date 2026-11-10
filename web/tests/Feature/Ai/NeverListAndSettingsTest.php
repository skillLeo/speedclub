<?php

use App\Models\User;
use App\Services\Ai\Agents\DescriptionAgent;
use App\Services\Ai\Agents\ModSuggestAgent;
use App\Services\Ai\Agents\PhotoCategoryAgent;
use App\Services\Ai\Agents\SearchInterpreterAgent;
use App\Services\Ai\Agents\SpeedClubAgent;
use App\Services\Ai\Agents\TranslateAgent;
use App\Services\Ai\Agents\TriageAgent;
use App\Services\Ai\NeverList;
use App\Services\Ai\Numbers;
use Illuminate\JsonSchema\JsonSchemaTypeFactory;

require_once __DIR__.'/AiTestHelpers.php';

/**
 * 02_PRODUCT_SPEC §6 "Never" in every prompt and schema, the number guard, and the opt-in setting.
 */
dataset('agents', [SearchInterpreterAgent::class, ModSuggestAgent::class, PhotoCategoryAgent::class, TranslateAgent::class, DescriptionAgent::class, TriageAgent::class]);

it('puts the "Never" rules into every agent and a refused flag into every schema', function (string $agent) {
    /** @var SpeedClubAgent $instance */
    $instance = new $agent;
    $schema = $instance->schema(new JsonSchemaTypeFactory);

    expect($instance->instructions())->toContain(NeverList::RULES)
        ->toContain('not a chatbot')->toContain('horsepower')->toContain('legal')->toContain('generated images')
        ->and($schema)->toHaveKey('refused')
        ->and(array_keys($schema))->not->toContain('power_gain')->not->toContain('legal_status')->not->toContain('image');
})->with('agents');

it('keeps the schemas free of power predictions, legality and images', function (string $agent) {
    $json = json_encode(array_map(fn ($type) => $type->toArray(), (new $agent)->schema(new JsonSchemaTypeFactory)));

    expect($json)->not->toContain('power_gain')->not->toContain('legal')->not->toContain('image_url');
})->with('agents');

it('finds every number of a text and accepts only numbers of the input', function () {
    expect(Numbers::in('8,5J x 19 ET35, 1.998 ccm, M4 G82 mit 510 PS'))->toBe(['8.5', '19', '35', '1998', '4', '82', '510'])
        ->and(Numbers::allFrom('19 Zoll und 8.5 J', '8,5x19'))->toBeTrue()
        ->and(Numbers::allFrom('jetzt 600 PS', 'M4 mit 510 PS'))->toBeFalse()
        ->and(Numbers::isFrom(19.0, 'BBS 19 Zoll'))->toBeTrue();
});

it('rejects a legality or power claim only when the input did not already make it', function () {
    expect(NeverList::violatedBy('Komplett TÜV-konform.', 'BMW M4'))->toBeTrue()
        ->and(NeverList::violatedBy('Mit spürbarer Mehrleistung.', 'BMW M4'))->toBeTrue()
        ->and(NeverList::violatedBy('Gewindefahrwerk von KW.', 'KW V3'))->toBeFalse();
});

describe('ai_suggestions setting (SET privacy)', function () {
    it('is off by default and the member switches it on and off', function () {
        aiActAs(User::factory()->create());

        $this->getJson('/api/v1/me/settings')->assertOk()->assertJsonPath('data.ai_suggestions', false);
        $this->patchJson('/api/v1/me/settings', ['ai_suggestions' => true])->assertOk()->assertJsonPath('data.ai_suggestions', true);
        $this->patchJson('/api/v1/me/settings', ['ai_suggestions' => false])->assertOk()->assertJsonPath('data.ai_suggestions', false);
        $this->patchJson('/api/v1/me/settings', ['ai_suggestions' => 'yes'])->assertUnprocessable()->assertJsonValidationErrors('ai_suggestions');
    });

    it('needs a signed-in member', function () {
        $this->patchJson('/api/v1/me/settings', ['ai_suggestions' => true])->assertUnauthorized();
    });
});
