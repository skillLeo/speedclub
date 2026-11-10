<?php

namespace App\Providers;

use App\Enums\AiFeature;
use App\Enums\MediaStatus;
use App\Jobs\Ai\TriageMedia;
use App\Jobs\Ai\TriageModerationCase;
use App\Models\AiCall;
use App\Models\AiTranslation;
use App\Models\Media;
use App\Models\ModerationCase;
use App\Models\Report;
use App\Services\Ai\AiGateway;
use App\Services\Ai\Triage;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Support\ServiceProvider;

/**
 * M3.7 [AI] wiring (m3.7 contract §1): the moderation triage is queued on a new report and on a new public photo while ai.moderation_triage
 * is on and a provider is configured (database queue, after the commit), and a staff case on a photo the triage flagged is marked
 * ai_detected when it is created. Model events, so the M2.6/M3.4 report and media code stays untouched.
 */
class AiServiceProvider extends ServiceProvider
{
    /** Where a photo is public (member media of a conversation is never sent to a provider). */
    private const PUBLIC_PARENTS = ['vehicle', 'modification', 'user'];

    public function boot(): void
    {
        // Internal rows, never in a morph relation; named anyway so the enforced map stays complete (SchemaTest).
        Relation::morphMap(['ai_call' => AiCall::class, 'ai_translation' => AiTranslation::class]);

        ModerationCase::creating(fn (ModerationCase $case) => Triage::markDetection($case));

        Report::created(function (Report $report): void {
            if (is_string($report->getAttribute('case_id')) && app(AiGateway::class)->enabled(AiFeature::ModerationTriage)) {
                TriageModerationCase::dispatch((string) $report->getAttribute('case_id'))->afterCommit();
            }
        });

        Media::saved(function (Media $photo): void {
            if ($photo->status !== MediaStatus::Ready
                || $photo->getAttribute('ai_scored_at') !== null
                || ! in_array($photo->getAttribute('mediable_type'), self::PUBLIC_PARENTS, true)
                || ! ($photo->wasRecentlyCreated || $photo->wasChanged(['status', 'mediable_type', 'mediable_id']))) {
                return;
            }

            if (app(AiGateway::class)->enabled(AiFeature::ModerationTriage)) {
                TriageMedia::dispatch((string) $photo->getKey())->afterCommit();
            }
        });
    }
}
