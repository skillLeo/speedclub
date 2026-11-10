<?php

use App\Enums\KeywordList;
use App\Enums\ReportSource;
use App\Enums\ReportTargetType;
use App\Models\BuildUpdate;
use App\Models\KeywordRule;
use App\Models\Message;
use App\Models\ModerationCase;
use App\Models\Report;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Rules\KeywordNormaliser;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

require_once __DIR__.'/Helpers.php';

/**
 * ADM-23 keyword rules on every listed member write path (m3.4-contract §1 and §3): a block-list term refuses the write with 422
 * content_blocked and a neutral message on the field; a flag-list term lets it through and opens a case with an automated report.
 * Message bodies are flag only, never blocked. Staff writes are not checked.
 */
beforeEach(function () {
    adm34Rule('Darknet', KeywordList::Block);
    adm34Rule('Rabattcode', KeywordList::Flag);
    $this->member = User::factory()->create();
    Sanctum::actingAs($this->member);
});

function adm34AutomatedCase(ReportTargetType $type, string $id): ?ModerationCase
{
    return ModerationCase::query()->where('target_type', $type->value)->where('target_id', $id)->where('automated', true)->first();
}

describe('normal form', function () {
    it('matches whole words, any case, umlauts both ways and punctuation inside a word', function (string $text, bool $hit) {
        expect(KeywordNormaliser::matches(KeywordNormaliser::textForms($text), 'Rabattcode'))->toBe($hit);
    })->with([
        ['Mit RABATTCODE gibt es 10 %', true],
        ['rabatt-code? oder Rabatt.Code!', true],
        ['Rabatt Code als zwei Wörter', false],
        ['R-a-b-a-t-t-c-o-d-e', true],
        ['Rabattcodes sammeln', false],
        ['Ein normaler Text über Felgen', false],
    ]);

    it('folds German letters both ways', function () {
        $forms = KeywordNormaliser::textForms('Das ist Müll');
        expect(KeywordNormaliser::matches($forms, 'Muell'))->toBeTrue()
            ->and(KeywordNormaliser::matches($forms, 'Mull'))->toBeTrue()
            ->and(KeywordNormaliser::matches(KeywordNormaliser::textForms('Das ist Muell'), 'Müll'))->toBeTrue();
    });
});

describe('vehicle description', function () {
    it('refuses a blocked term on create and on edit, neutrally', function () {
        $this->postJson('/api/v1/vehicles', ['make_text' => 'BMW', 'description' => 'Teile gibt es im Darknet'])
            ->assertStatus(422)->assertJsonPath('code', 'content_blocked')->assertJsonValidationErrors('description')
            ->assertJsonMissing(['Darknet']);
        expect(Vehicle::query()->withoutGlobalScopes()->where('owner_id', $this->member->id)->count())->toBe(0);

        $vehicle = Vehicle::factory()->published()->create(['owner_id' => $this->member->id, 'description' => 'Alt']);
        $this->patchJson("/api/v1/vehicles/{$vehicle->id}", ['description' => 'Jetzt mit darknet-Teilen'])->assertStatus(422)->assertJsonPath('code', 'content_blocked');
        expect($vehicle->refresh()->description)->toBe('Alt');
    });

    it('saves a flagged term and opens an automated case, once per open case', function () {
        $vehicle = Vehicle::factory()->published()->create(['owner_id' => $this->member->id]);
        $this->patchJson("/api/v1/vehicles/{$vehicle->id}", ['description' => 'Mit Rabattcode SPEED10 im Shop'])->assertOk();
        $this->patchJson("/api/v1/vehicles/{$vehicle->id}", ['description' => 'Mit Rabattcode SPEED20 im Shop'])->assertOk();

        $case = adm34AutomatedCase(ReportTargetType::Vehicle, $vehicle->id);
        expect($case)->not->toBeNull()
            ->and(Report::query()->where('case_id', $case?->id)->where('source', ReportSource::Automated->value)->count())->toBe(1)
            ->and(Report::query()->where('case_id', $case?->id)->value('reporter_id'))->toBeNull()
            ->and((int) DB::table('keyword_rule_hits')->sum('hits'))->toBe(2);
    });
});

describe('build note', function () {
    it('refuses a blocked note and flags a flagged one', function () {
        $vehicle = Vehicle::factory()->published()->create(['owner_id' => $this->member->id]);
        $this->postJson("/api/v1/vehicles/{$vehicle->id}/updates", ['note' => 'Bestellt im DARKNET'])->assertStatus(422)->assertJsonPath('code', 'content_blocked')->assertJsonValidationErrors('note');
        expect(BuildUpdate::query()->where('vehicle_id', $vehicle->id)->where('type', 'note')->count())->toBe(0);

        $this->postJson("/api/v1/vehicles/{$vehicle->id}/updates", ['note' => 'Neue Felgen, Rabattcode im Profil'])->assertCreated();
        $update = BuildUpdate::query()->where('vehicle_id', $vehicle->id)->where('type', 'note')->sole();
        expect(adm34AutomatedCase(ReportTargetType::BuildUpdate, $update->id))->not->toBeNull();
    });
});

describe('profile', function () {
    it('refuses a blocked bio or display name', function (string $field) {
        $this->patchJson('/api/v1/me/profile', [$field => 'Alles aus dem Darknet'])->assertStatus(422)->assertJsonPath('code', 'content_blocked')->assertJsonValidationErrors($field);
        expect($this->member->refresh()->getAttribute($field))->not->toBe('Alles aus dem Darknet');
    })->with(['bio', 'display_name']);

    it('flags a flagged bio', function () {
        $this->patchJson('/api/v1/me/profile', ['bio' => 'Rabattcode in der Bio'])->assertOk();
        expect(adm34AutomatedCase(ReportTargetType::Member, $this->member->id))->not->toBeNull();
    });
});

describe('message bodies', function () {
    it('never blocks a message, only flags it, on start and on send', function () {
        $recipient = User::factory()->create();
        socFollow($recipient, $this->member);
        $start = $this->postJson('/api/v1/conversations', msgStartBody($recipient, ['message' => ['body' => 'Darknet und Rabattcode, schau mal']]));
        expect($start->status())->toBeIn([200, 201]);
        $message = Message::query()->where('sender_id', $this->member->id)->sole();
        expect(adm34AutomatedCase(ReportTargetType::Message, $message->id))->not->toBeNull();

        $this->postJson("/api/v1/conversations/{$message->conversation_id}/messages", ['type' => 'text', 'body' => 'Nochmal: Darknet', 'client_id' => (string) Str::uuid()])->assertCreated();
        expect(Message::query()->where('sender_id', $this->member->id)->count())->toBe(2);
    });
});

it('does not check staff edits of a profile', function () {
    $staff = adm34As('owner');
    $member = adm32Member();
    $this->patch("/admin/members/{$member->id}", ['bio' => 'Darknet', 'display_name' => 'Jonas', 'reason' => adm32Reason()]);
    expect(KeywordRule::query()->count())->toBe(2)->and($staff)->not->toBeNull();
    expect(ModerationCase::query()->where('target_id', $member->id)->where('automated', true)->exists())->toBeFalse();
});
