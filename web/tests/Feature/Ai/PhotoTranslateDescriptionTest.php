<?php

use App\Enums\AiFeature;
use App\Enums\AiOutcome;
use App\Enums\MediaCategory;
use App\Enums\MediaStatus;
use App\Enums\RestrictionType;
use App\Models\AiTranslation;
use App\Models\Block;
use App\Models\BuildUpdate;
use App\Models\Make;
use App\Models\Media;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Models\VehicleSpec;
use App\Services\Ai\Agents\DescriptionAgent;
use App\Services\Ai\Agents\PhotoCategoryAgent;
use App\Services\Ai\Agents\TranslateAgent;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Ai\Files\StoredImage;
use Laravel\Ai\Prompts\AgentPrompt;

require_once __DIR__.'/AiTestHelpers.php';
require_once __DIR__.'/../Messaging/MessagingTestHelpers.php';

beforeEach(function () {
    $this->withHeader('Accept-Language', 'de');
    aiOn(AiFeature::PhotoTagging, AiFeature::Translate, AiFeature::DescriptionAssist);
    $this->owner = aiMember(attributes: ['username' => 'lukas.sc']);
    $this->vehicle = Vehicle::factory()->published()->create(['owner_id' => $this->owner->id, 'description' => 'Tiefer, breiter, 19 Zoll BBS.']);
});

describe('ai/photos/{media}/category', function () {
    beforeEach(function () {
        $this->photo = Media::factory()->forModel($this->vehicle)->create(['owner_id' => $this->owner->id]);
    });

    it('suggests a category from the 640 variant for the owner', function () {
        PhotoCategoryAgent::fake([['refused' => false, 'category' => 'interior']]);
        aiActAs($this->owner);

        $this->postJson('/api/v1/ai/photos/'.$this->photo->id.'/category')->assertOk()
            ->assertExactJson(['data' => ['category' => 'interior', 'category_label' => __('enums.media_category.interior'), 'label' => 'KI-Vorschlag']]);

        PhotoCategoryAgent::assertPrompted(fn (AgentPrompt $prompt): bool => $prompt->attachments->count() === 1
            && $prompt->attachments->first() instanceof StoredImage
            && $prompt->attachments->first()->path === $this->photo->variants['640']);
        expect($this->photo->fresh()->category)->not->toBe(MediaCategory::Interior);
    });

    it('is the owner\'s only: another member, a blocked one and a restricted owner are refused', function () {
        PhotoCategoryAgent::fake()->preventStrayPrompts();

        aiActAs(aiMember());
        $this->postJson('/api/v1/ai/photos/'.$this->photo->id.'/category')->assertForbidden();

        $blocked = aiMember();
        Block::factory()->create(['blocker_id' => $this->owner->id, 'blocked_id' => $blocked->id]);
        aiActAs($blocked);
        $this->postJson('/api/v1/ai/photos/'.$this->photo->id.'/category')->assertForbidden();

        aiActAs($this->owner->fresh());
        $this->owner->forceFill(['restrictions' => null])->save();
        $restricted = User::factory()->restrictedFrom(RestrictionType::Publishing)->create(['ai_suggestions' => true]);
        $theirs = Media::factory()->forModel(Vehicle::factory()->published()->create(['owner_id' => $restricted->id]))->create(['owner_id' => $restricted->id]);
        aiActAs($restricted);
        $this->postJson('/api/v1/ai/photos/'.$theirs->id.'/category')->assertForbidden();

        PhotoCategoryAgent::assertNeverPrompted();
    });

    it('waits for a processed photo: 409', function () {
        $this->photo->forceFill(['status' => MediaStatus::Processing, 'variants' => []])->save();
        aiActAs($this->owner);

        $this->postJson('/api/v1/ai/photos/'.$this->photo->id.'/category')->assertConflict();
    });

    it('rejects a category outside the five', function () {
        PhotoCategoryAgent::fake([['refused' => false, 'category' => 'other']]);
        aiActAs($this->owner);

        $this->postJson('/api/v1/ai/photos/'.$this->photo->id.'/category')->assertUnprocessable()->assertJsonPath('code', 'ai_unverifiable');
        expect(aiLastCall()->outcome)->toBe(AiOutcome::Invalid);
    });
});

describe('ai/translate', function () {
    it('translates what the member may read, labelled and cached for 30 days', function () {
        TranslateAgent::fake([['refused' => false, 'text' => 'Lower, wider, 19 inch BBS.']])->preventStrayPrompts();
        aiActAs(aiMember(false));
        $body = ['source' => 'vehicle_description', 'id' => $this->vehicle->id, 'to' => 'en'];

        $this->postJson('/api/v1/ai/translate', $body)->assertOk()
            ->assertExactJson(['data' => ['text' => 'Lower, wider, 19 inch BBS.', 'to' => 'en', 'label' => 'Übersetzt', 'cached' => false]]);
        $this->postJson('/api/v1/ai/translate', $body)->assertOk()->assertJsonPath('data.cached', true);

        TranslateAgent::assertPromptedTimes(1);
        $row = AiTranslation::query()->sole();
        expect($row->expires_at->isBetween(now()->addDays(29), now()->addDays(31)))->toBeTrue()
            ->and(DB::table('ai_translations')->value('text'))->not->toContain('Lower');
    });

    it('translates an edited source anew', function () {
        TranslateAgent::fake([['refused' => false, 'text' => 'Lower, wider, 19 inch BBS.'], ['refused' => false, 'text' => 'Now on air suspension.']]);
        aiActAs(aiMember());
        $body = ['source' => 'vehicle_description', 'id' => $this->vehicle->id, 'to' => 'en'];

        $this->postJson('/api/v1/ai/translate', $body)->assertOk();
        $this->vehicle->forceFill(['description' => 'Jetzt mit Luftfahrwerk.'])->save();

        $this->postJson('/api/v1/ai/translate', $body)->assertOk()->assertJsonPath('data.text', 'Now on air suspension.');
    });

    it('answers 404 for a source the member may not read: private vehicle, blocked owner, hidden update, foreign message', function () {
        TranslateAgent::fake()->preventStrayPrompts();
        $stranger = aiActAs(aiMember());

        $private = Vehicle::factory()->private()->create(['owner_id' => $this->owner->id, 'description' => 'Geheim.']);
        $this->postJson('/api/v1/ai/translate', ['source' => 'vehicle_description', 'id' => $private->id, 'to' => 'en'])->assertNotFound();

        Block::factory()->create(['blocker_id' => $this->owner->id, 'blocked_id' => $stranger->id]);
        $this->postJson('/api/v1/ai/translate', ['source' => 'vehicle_description', 'id' => $this->vehicle->id, 'to' => 'en'])->assertNotFound();

        $hidden = BuildUpdate::factory()->create(['vehicle_id' => Vehicle::factory()->published()->create()->id, 'note' => 'Versteckt.', 'hidden' => true]);
        $this->postJson('/api/v1/ai/translate', ['source' => 'build_update', 'id' => $hidden->id, 'to' => 'en'])->assertNotFound();

        $a = aiMember();
        $b = aiMember();
        $message = msgStart($a, $b, 'Moin, fährst du das KW V3 auf Stufe 6?');
        $this->postJson('/api/v1/ai/translate', ['source' => 'message', 'id' => $message->id, 'to' => 'en'])->assertNotFound();
        $this->postJson('/api/v1/ai/translate', ['source' => 'message', 'id' => strtolower((string) Str::ulid()), 'to' => 'en'])->assertNotFound();

        TranslateAgent::assertNeverPrompted();
    });

    it('translates a message for its participants', function () {
        TranslateAgent::fake([['refused' => false, 'text' => 'Hi, do you run the KW V3 on setting 6?']]);
        $a = aiMember();
        $b = aiMember();
        $message = msgStart($a, $b, 'Moin, fährst du das KW V3 auf Stufe 6?');
        aiActAs($b);

        $this->postJson('/api/v1/ai/translate', ['source' => 'message', 'id' => $message->id, 'to' => 'en'])->assertOk()
            ->assertJsonPath('data.text', 'Hi, do you run the KW V3 on setting 6?');
        expect(aiCallLog())->not->toContain('Stufe')->not->toContain('setting');
    });

    it('translates a visible build update note', function () {
        $update = BuildUpdate::factory()->create(['vehicle_id' => $this->vehicle->id, 'note' => 'Neue Bremsen montiert.']);
        TranslateAgent::fake([['refused' => false, 'text' => 'New brakes fitted.']]);
        aiActAs(aiMember());

        $this->postJson('/api/v1/ai/translate', ['source' => 'build_update', 'id' => $update->id, 'to' => 'en'])->assertOk()->assertJsonPath('data.text', 'New brakes fitted.');
    });

    it('rejects a translation that changes a number', function () {
        TranslateAgent::fake([['refused' => false, 'text' => 'Lower, wider, 20 inch BBS.']]);
        aiActAs(aiMember());

        $this->postJson('/api/v1/ai/translate', ['source' => 'vehicle_description', 'id' => $this->vehicle->id, 'to' => 'en'])
            ->assertUnprocessable()->assertJsonPath('code', 'ai_unverifiable');
        expect(AiTranslation::query()->count())->toBe(0);
    });

    it('has nothing to translate on an empty description', function () {
        $this->vehicle->forceFill(['description' => null])->save();
        aiActAs(aiMember());

        $this->postJson('/api/v1/ai/translate', ['source' => 'vehicle_description', 'id' => $this->vehicle->id, 'to' => 'en'])
            ->assertUnprocessable()->assertJsonValidationErrors('id');
    });
});

describe('ai/vehicles/{vehicle}/description', function () {
    beforeEach(function () {
        $make = Make::factory()->create(['name' => 'BMW', 'slug' => 'bmw']);
        $model = VehicleModel::factory()->create(['make_id' => $make->id, 'name' => 'M4', 'slug' => 'm4']);
        $this->vehicle->forceFill(['make_id' => $make->id, 'model_id' => $model->id, 'model_year' => 2021, 'description' => 'Bitte nicht verwenden: 999 PS'])->save();
        VehicleSpec::factory()->create(['vehicle_id' => $this->vehicle->id, 'power_value' => 510, 'power_ps' => 510]);
    });

    it('writes from the structured data only', function () {
        DescriptionAgent::fake([['refused' => false, 'text' => 'Ein BMW M4 von 2021 mit 510 PS und S58-Motor.']]);
        aiActAs($this->owner);

        $this->postJson('/api/v1/ai/vehicles/'.$this->vehicle->id.'/description')->assertOk()
            ->assertExactJson(['data' => ['text' => 'Ein BMW M4 von 2021 mit 510 PS und S58-Motor.', 'label' => 'KI-Vorschlag']]);

        DescriptionAgent::assertPrompted(fn (AgentPrompt $prompt): bool => $prompt->contains('"model":"M4"') && $prompt->contains('510') && ! $prompt->contains('999') && ! $prompt->contains('Bitte nicht'));
        expect($this->vehicle->fresh()->description)->toBe('Bitte nicht verwenden: 999 PS');
    });

    it('rejects an invented number: 422 ai_unverifiable, outcome invalid', function () {
        DescriptionAgent::fake([['refused' => false, 'text' => 'Ein BMW M4 mit 600 PS nach dem Tuning.']]);
        aiActAs($this->owner);

        $this->postJson('/api/v1/ai/vehicles/'.$this->vehicle->id.'/description')->assertUnprocessable()->assertJsonPath('code', 'ai_unverifiable');
        expect(aiLastCall()->outcome)->toBe(AiOutcome::Invalid);
    });

    it('rejects a legality judgement or a power prediction the data did not contain', function (string $text) {
        DescriptionAgent::fake([['refused' => false, 'text' => $text]]);
        aiActAs($this->owner);

        $this->postJson('/api/v1/ai/vehicles/'.$this->vehicle->id.'/description')->assertUnprocessable()->assertJsonPath('code', 'ai_unverifiable');
    })->with([
        'legality' => 'Ein BMW M4, komplett TÜV-konform und straßenlegal.',
        'power' => 'Ein BMW M4 mit spürbarer Mehrleistung.',
    ]);

    it('is the owner\'s only', function () {
        DescriptionAgent::fake()->preventStrayPrompts();

        aiActAs(aiMember());
        $this->postJson('/api/v1/ai/vehicles/'.$this->vehicle->id.'/description')->assertForbidden();

        $restricted = User::factory()->restrictedFrom(RestrictionType::Publishing)->create(['ai_suggestions' => true]);
        aiActAs($restricted);
        $theirs = Vehicle::factory()->published()->create(['owner_id' => $restricted->id]);
        $this->postJson('/api/v1/ai/vehicles/'.$theirs->id.'/description')->assertForbidden();

        DescriptionAgent::assertNeverPrompted();
    });
});
