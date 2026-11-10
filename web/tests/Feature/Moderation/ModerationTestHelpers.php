<?php

use App\Actions\Moderation\DecideCase;
use App\Actions\Moderation\SubmitReport;
use App\Enums\DecisionAction;
use App\Enums\GroundDocument;
use App\Enums\ReportReason;
use App\Enums\ReportSource;
use App\Enums\ReportTargetType;
use App\Enums\RestrictionType;
use App\Models\Decision;
use App\Models\Media;
use App\Models\ModerationCase;
use App\Models\Report;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Moderation\DecisionInput;
use App\Services\Moderation\ReportDraft;
use App\Services\Moderation\ReportTargets;
use Carbon\CarbonImmutable;

require_once __DIR__.'/../Social/SocialTestHelpers.php';
require_once __DIR__.'/../Messaging/MessagingTestHelpers.php';

/**
 * M2.6 test helpers, prefixed mod… so they never collide with another file's functions.
 */
function modVehicle(?User $owner = null): Vehicle
{
    return Vehicle::factory()->published()->create($owner === null ? [] : ['owner_id' => $owner->id]);
}

function modPhoto(Vehicle $vehicle, int $sort = 1): Media
{
    return Media::factory()->forModel($vehicle)->create(['owner_id' => $vehicle->owner_id, 'sort' => $sort]);
}

/**
 * A report through the Action, as POST reports would file it.
 */
function modReport(User $reporter, ReportTargetType $type, string $id, ReportReason $reason = ReportReason::Spam): Report
{
    return app(SubmitReport::class)->handle(
        app(ReportTargets::class)->forMember($reporter, $type, $id),
        new ReportDraft(source: ReportSource::App, reporter: $reporter, reason: $reason, details: 'Wirbt für einen fremden Shop.'),
    );
}

function modCaseOf(Report $report): ModerationCase
{
    return ModerationCase::query()->findOrFail($report->case_id);
}

/**
 * @param  array<string, mixed>  $overrides  named arguments of DecisionInput
 */
function modDecide(ModerationCase $case, DecisionAction $action = DecisionAction::RemoveContent, array $overrides = []): Decision
{
    return app(DecideCase::class)->handle($case, new DecisionInput(...array_replace([
        'action' => $action,
        'facts' => 'Das Profil warb für einen fremden Shop mit Rabattcode.',
        'ground' => 'Community-Richtlinien §6 (Kein Spam)',
        'groundDocument' => GroundDocument::Community,
        'groundSection' => '6',
        'automatedDetection' => false,
        'restriction' => $action === DecisionAction::Restrict ? RestrictionType::Messaging : null,
        'until' => null,
        'reason' => 'Test',
    ], $overrides)));
}

/**
 * A decided remove_content case about a photo of $affected, reported by $reporter, decided at $at (else now). Returns the decision.
 */
function modDecidedPhoto(User $affected, User $reporter, ?CarbonImmutable $at = null): Decision
{
    $photo = modPhoto(modVehicle($affected), 2);
    $report = modReport($reporter, ReportTargetType::Photo, $photo->id);

    // The clock stays at $at: the test moves it on itself.
    if ($at !== null) {
        test()->travelTo($at);
    }

    return modDecide(modCaseOf($report));
}

/**
 * @param  array<string, mixed>  $overrides
 * @return array<string, mixed>
 */
function modBody(string $type, string $id, array $overrides = []): array
{
    return array_replace(['target_type' => $type, 'target_id' => $id, 'reason' => 'spam', 'details' => 'Wirbt für einen fremden Shop.'], $overrides);
}
