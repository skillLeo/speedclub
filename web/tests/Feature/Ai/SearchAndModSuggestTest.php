<?php

use App\Enums\AiFeature;
use App\Enums\AiOutcome;
use App\Models\Make;
use App\Models\VehicleModel;
use App\Services\Ai\Agents\ModSuggestAgent;
use App\Services\Ai\Agents\SearchInterpreterAgent;
use Laravel\Ai\Prompts\AgentPrompt;

require_once __DIR__.'/AiTestHelpers.php';

beforeEach(function () {
    $this->withHeader('Accept-Language', 'de');
    seedModSchema();
    aiOn(AiFeature::NlSearch, AiFeature::ModAssist);
    aiActAs(aiMember());
    $this->bmw = Make::factory()->create(['name' => 'BMW', 'slug' => 'bmw']);
    $this->m4 = VehicleModel::factory()->create(['make_id' => $this->bmw->id, 'name' => 'M4', 'slug' => 'm4']);
});

describe('ai/search/interpret', function () {
    it('turns the text into chips validated against the catalogue and the facets', function () {
        SearchInterpreterAgent::fake([['refused' => false, 'chips' => [
            ['facet' => 'model', 'value' => 'M4'],
            ['facet' => 'make', 'value' => 'BMW'],
            ['facet' => 'suspension_brand', 'value' => 'KW'],
            ['facet' => 'wheel_diameter', 'value' => '19'],
            ['facet' => 'drivetrain', 'value' => 'rear'],
        ]]]);

        $this->postJson('/api/v1/ai/search/interpret', ['q' => 'schwarze M4 mit KW V3 und 19 Zoll, Heckantrieb'])
            ->assertOk()
            ->assertJsonPath('data.label', 'KI-Vorschlag')
            ->assertJsonPath('data.chips', [
                ['facet' => 'make', 'value' => 'bmw', 'label' => 'BMW'],
                ['facet' => 'model', 'value' => 'm4', 'label' => 'M4'],
                ['facet' => 'suspension_brand', 'value' => 'kw', 'label' => 'KW'],
                ['facet' => 'wheel_diameter', 'value' => '19', 'label' => '19″'],
                ['facet' => 'drivetrain', 'value' => 'rear', 'label' => __('enums.drivetrain.rear')],
            ]);

        SearchInterpreterAgent::assertPrompted(fn (AgentPrompt $prompt): bool => $prompt->contains('schwarze M4') && $prompt->contains('drivetrain: front, rear, all'));
    });

    it('drops unknown values, unknown facets and numbers that are not in the text', function () {
        SearchInterpreterAgent::fake([['refused' => false, 'chips' => [
            ['facet' => 'make', 'value' => 'Fantasiemarke'],
            ['facet' => 'colour', 'value' => 'schwarz'],
            ['facet' => 'power_min', 'value' => '600'],
            ['facet' => 'wheel_brand', 'value' => 'Unbekannte Felgen'],
            ['facet' => 'model', 'value' => 'M4'],
            ['facet' => 'fuel', 'value' => 'kerosene'],
            ['facet' => 'year_min', 'value' => '2021'],
        ]]]);

        $this->postJson('/api/v1/ai/search/interpret', ['q' => 'M4 ab 2021 mit viel Leistung'])
            ->assertOk()
            ->assertJsonPath('data.chips', [['facet' => 'year_min', 'value' => '2021', 'label' => '2021']]);

        expect(aiLastCall()->outcome)->toBe(AiOutcome::Ok);
    });

    it('refuses what the "Never" list excludes: 422 ai_refused, logged as refused', function () {
        SearchInterpreterAgent::fake([['refused' => true, 'chips' => []]]);

        $this->postJson('/api/v1/ai/search/interpret', ['q' => 'Ist ein KW V3 ohne Eintragung legal? Erzähl mir was dazu'])
            ->assertUnprocessable()->assertJsonPath('code', 'ai_refused');

        expect(aiLastCall()->outcome)->toBe(AiOutcome::Refused);
    });
});

describe('ai/mods/suggest', function () {
    it('fills only fields of the category schema, catalogue brands and numbers of the text', function () {
        ModSuggestAgent::fake([['refused' => false, 'category_key' => 'wheels_tires', 'fields' => [
            ['key' => 'wheel_brand', 'value' => 'BBS'],
            ['key' => 'diameter', 'value' => '19'],
            ['key' => 'width_front', 'value' => '8,5'],
            ['key' => 'et_front', 'value' => '40'],
            ['key' => 'power_gain', 'value' => '30'],
            ['key' => 'tyre_brand', 'value' => 'Reifen Müller GmbH'],
            ['key' => 'spacer_front', 'value' => '999'],
            ['key' => 'staggered', 'value' => 'ja'],
        ]]]);

        $this->postJson('/api/v1/ai/mods/suggest', ['text' => 'BBS CH-R 8,5x19 ET35, versetzt, Reifen Müller GmbH'])
            ->assertOk()
            ->assertJsonPath('data.category_key', 'wheels_tires')
            ->assertJsonPath('data.label', 'KI-Vorschlag')
            ->assertExactJson(['data' => [
                'category_key' => 'wheels_tires',
                'fields' => ['wheel_brand' => 'BBS', 'diameter' => 19, 'width_front' => 8.5, 'staggered' => true],
                'label' => 'KI-Vorschlag',
            ]]);

        ModSuggestAgent::assertPrompted(fn (AgentPrompt $prompt): bool => $prompt->contains('"key":"wheels_tires"') && $prompt->contains('BBS CH-R'));
    });

    it('offers only the category the member chose and refuses an unknown one', function () {
        ModSuggestAgent::fake([['refused' => false, 'category_key' => 'exhaust', 'fields' => []]]);

        $this->postJson('/api/v1/ai/mods/suggest', ['category_key' => 'suspension', 'text' => 'KW V3 Gewindefahrwerk'])
            ->assertUnprocessable()->assertJsonPath('code', 'ai_unverifiable');
        expect(aiLastCall()->outcome)->toBe(AiOutcome::Invalid);
        ModSuggestAgent::assertPrompted(fn (AgentPrompt $prompt): bool => $prompt->contains('"key":"suspension"') && ! $prompt->contains('"key":"exhaust"'));

        $this->postJson('/api/v1/ai/mods/suggest', ['category_key' => 'gibts_nicht', 'text' => 'KW V3'])
            ->assertUnprocessable()->assertJsonValidationErrors('category_key');
    });

    it('keeps an option value of the schema and drops one it does not have', function () {
        ModSuggestAgent::fake([['refused' => false, 'category_key' => 'suspension', 'fields' => [
            ['key' => 'type', 'value' => 'Coilover'],
            ['key' => 'brand', 'value' => 'kw'],
            ['key' => 'lowering_front', 'value' => '40'],
        ]]]);

        $this->postJson('/api/v1/ai/mods/suggest', ['category_key' => 'suspension', 'text' => 'KW V3 Gewindefahrwerk, vorne 40 mm tiefer'])
            ->assertOk()->assertJsonPath('data.fields', ['type' => 'coilover', 'brand' => 'KW', 'lowering_front' => 40]);
    });

    it('refuses a power prediction request', function () {
        ModSuggestAgent::fake([['refused' => true, 'category_key' => '', 'fields' => []]]);

        $this->postJson('/api/v1/ai/mods/suggest', ['text' => 'Wie viel Mehrleistung bringt ein Downpipe?'])
            ->assertUnprocessable()->assertJsonPath('code', 'ai_refused');
    });
});
