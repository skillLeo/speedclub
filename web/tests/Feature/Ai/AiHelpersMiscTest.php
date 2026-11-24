<?php

use App\Actions\Admin\Catalog\DeleteAiSpecSuggestions;
use App\Enums\AiFeature;
use App\Models\AiSpecSuggestion;
use App\Models\AuditEvent;
use App\Models\FeatureFlag;
use App\Models\Generation;
use App\Models\ModerationCase;
use App\Models\SorTemplate;
use App\Models\Vehicle;
use App\Services\Ai\Agents\TriageAgent;
use App\Services\Ai\Triage;
use App\Services\AppConfig\AppConfig;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Validation\ValidationException;
use Laravel\Ai\Prompts\AgentPrompt;

require_once __DIR__.'/AiTestHelpers.php';
require_once __DIR__.'/../Staff/Helpers.php';

/**
 * M5.9 (m5.9-contract §2.4, §2.5, §8; lead D-5, D-8): the triage's suggested statement-of-reasons template, every ai.* flag off in
 * app-config without a provider key, and staff deleting a wrong cached spec suggestion of a generation.
 */
describe('triage template suggestion', function () {
    beforeEach(function () {
        aiOn(AiFeature::ModerationTriage);
        // The statement-of-reasons templates are seeded by 2026_11_20_100000; the prompt offers the German ones.
        $this->templates = SorTemplate::query()->where('locale', 'de')->orderBy('sort')->orderBy('key')->limit(2)->pluck('label', 'key')->all();
        expect($this->templates)->toHaveCount(2);
        $vehicle = Vehicle::factory()->published()->create(['description' => 'Günstige Replika-Felgen abzugeben.']);
        $this->case = ModerationCase::factory()->create(['target_type' => 'vehicle', 'target_id' => $vehicle->id, 'open_target' => 'vehicle:'.$vehicle->id]);
    });

    it('stores a template key staff have, offers the templates in the prompt, and decides nothing', function () {
        [$first, $second] = array_keys($this->templates);
        TriageAgent::fake([['refused' => false, 'risk_score' => 70, 'risk_reason' => 'Mögliche Werbung.', 'template_key' => $first]]);

        expect(app(Triage::class)->scoreCase($this->case))->toBeTrue()
            ->and($this->case->fresh()?->ai_template_key)->toBe($first)
            ->and($this->case->fresh()?->decided_at)->toBeNull();
        TriageAgent::assertPrompted(fn (AgentPrompt $prompt): bool => $prompt->contains("- $first: ".$this->templates[$first]) && $prompt->contains("- $second: ".$this->templates[$second]));
    });

    it('drops a key staff do not have', function () {
        TriageAgent::fake([['refused' => false, 'risk_score' => 70, 'risk_reason' => 'Mögliche Werbung.', 'template_key' => 'made_up']]);

        app(Triage::class)->scoreCase($this->case);

        expect($this->case->fresh()?->ai_template_key)->toBeNull()->and($this->case->fresh()?->ai_score)->not->toBeNull();
    });
});

describe('app-config without a provider key', function () {
    it('reports every ai.* flag off while no key is configured, whatever the table says', function () {
        aiOn(AiFeature::VehicleSpecs, AiFeature::ForumSummary, AiFeature::Translate);
        FeatureFlag::query()->updateOrCreate(['key' => 'forum'], ['enabled' => true, 'description' => 'forum']);
        app(AppConfig::class)->flush();

        $flags = $this->getJson('/api/v1/app-config')->assertOk()->json('data.flags');
        expect($flags['ai.vehicle_specs'])->toBeTrue()->and($flags['ai.forum_summary'])->toBeTrue()->and($flags['forum'])->toBeTrue();

        aiProvider(false);
        app(AppConfig::class)->flush();

        $flags = $this->getJson('/api/v1/app-config')->assertOk()->json('data.flags');
        expect($flags['ai.vehicle_specs'])->toBeFalse()
            ->and($flags['ai.forum_summary'])->toBeFalse()
            ->and($flags['ai.translate'])->toBeFalse()
            ->and($flags['forum'])->toBeTrue();
    });
});

describe('staff deleting a cached spec suggestion (D-5)', function () {
    it('deletes the generation\'s suggestion, audited with the reason', function () {
        $generation = Generation::factory()->create();
        AiSpecSuggestion::factory()->create(['generation_id' => $generation->id]);
        $other = AiSpecSuggestion::factory()->create();
        $staff = m31Staff('admin');

        expect(app(DeleteAiSpecSuggestions::class)->handle($staff, $generation, 'Leistungsangabe des 330Ci war falsch.'))->toBe(1)
            ->and(AiSpecSuggestion::query()->pluck('id')->all())->toBe([$other->id]);

        $event = AuditEvent::query()->where('action', 'catalog.ai_specs_deleted')->sole();
        expect($event->getAttribute('reason'))->toBe('Leistungsangabe des 330Ci war falsch.')
            ->and($event->getAttribute('actor_id'))->toBe((string) $staff->id);

        expect(app(DeleteAiSpecSuggestions::class)->handle($staff, $generation, 'Noch einmal geprüft, nichts mehr da.'))->toBe(0)
            ->and(AuditEvent::query()->where('action', 'catalog.ai_specs_deleted')->count())->toBe(1);
    });

    it('needs catalog.manage; the reason is optional, at most 1,000 characters (ADR-540)', function () {
        $generation = Generation::factory()->create();
        AiSpecSuggestion::factory()->create(['generation_id' => $generation->id]);

        expect(fn () => app(DeleteAiSpecSuggestions::class)->handle(m31Staff('support'), $generation, 'Leistungsangabe war falsch.'))->toThrow(AuthorizationException::class)
            ->and(fn () => app(DeleteAiSpecSuggestions::class)->handle(m31Staff('admin'), $generation, str_repeat('x', 1001)))->toThrow(ValidationException::class)
            ->and(AiSpecSuggestion::query()->count())->toBe(1)
            ->and(app(DeleteAiSpecSuggestions::class)->handle(m31Staff('admin'), $generation, ''))->toBe(1)
            ->and(AiSpecSuggestion::query()->count())->toBe(0);
    });
});
