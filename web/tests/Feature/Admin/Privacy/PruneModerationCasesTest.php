<?php

use App\Enums\AppealStatus;
use App\Enums\CaseStatus;
use App\Models\Appeal;
use App\Models\Decision;
use App\Models\ModerationCase;
use App\Models\Report;
use App\Services\Privacy\RetentionPolicy;

/**
 * ADR-239: moderation cases go 36 months after the last thing that happened about them, unless redress still needs them (08 §4).
 */
function m36OldCase(array $case = [], ?array $decision = []): ModerationCase
{
    $old = now()->subMonths(37);
    $row = ModerationCase::factory()->decided()->create(['created_at' => $old, 'decided_at' => $old, ...$case]);

    if ($decision !== null) {
        Decision::factory()->create(['case_id' => $row->id, 'decided_at' => $old, 'created_at' => $old, ...$decision]);
    }

    return $row;
}

it('reads the 36 months from the retention policy', function () {
    expect(app(RetentionPolicy::class)->fixed('moderation_cases'))->toBe(36);
});

it('deletes an old decided case with its decisions, appeals and reports', function () {
    $case = m36OldCase();
    $decision = Decision::query()->where('case_id', $case->id)->sole();
    Appeal::factory()->create(['decision_id' => $decision->id, 'status' => AppealStatus::Upheld, 'created_at' => now()->subMonths(37), 'decided_at' => now()->subMonths(37)]);
    Report::factory()->create(['case_id' => $case->id, 'created_at' => now()->subMonths(38)]);

    $this->artisan('moderation:prune')->assertSuccessful();

    expect(ModerationCase::query()->whereKey($case->id)->exists())->toBeFalse()
        ->and(Decision::query()->whereKey($decision->id)->exists())->toBeFalse()
        ->and(Appeal::query()->where('decision_id', $decision->id)->exists())->toBeFalse()
        ->and(Report::query()->where('case_id', $case->id)->exists())->toBeFalse();
});

it('keeps what redress or the retention period still needs', function () {
    $recent = ModerationCase::factory()->decided()->create(['created_at' => now()->subMonths(20), 'decided_at' => now()->subMonths(20)]);
    $open = m36OldCase(['status' => CaseStatus::InReview, 'decided_at' => null, 'open_target' => 'member:open-old'], null);
    $openAppeal = m36OldCase();
    Appeal::factory()->create(['decision_id' => Decision::query()->where('case_id', $openAppeal->id)->value('id'), 'status' => AppealStatus::Open]);
    $freshDecision = m36OldCase(decision: ['decided_at' => now()->subMonths(2)]);
    $freshReport = m36OldCase();
    Report::factory()->create(['case_id' => $freshReport->id, 'created_at' => now()->subMonths(3)]);
    // An appeal of the old case's decision, reviewed in a case that is still open.
    $reviewed = m36OldCase();
    $appeal = Appeal::factory()->create(['decision_id' => Decision::query()->where('case_id', $reviewed->id)->value('id'), 'status' => AppealStatus::Upheld, 'created_at' => now()->subMonths(37), 'decided_at' => now()->subMonths(37)]);
    ModerationCase::factory()->create(['appeal_id' => $appeal->id, 'status' => CaseStatus::InReview, 'created_at' => now()->subMonths(37)]);

    $this->artisan('moderation:prune')->assertSuccessful();

    foreach ([$recent, $open, $openAppeal, $freshDecision, $freshReport, $reviewed] as $kept) {
        expect(ModerationCase::query()->whereKey($kept->id)->exists())->toBeTrue();
    }
});

it('prunes an old closed case without a decision', function () {
    $case = m36OldCase(['status' => CaseStatus::Closed], null);

    $this->artisan('moderation:prune')->assertSuccessful();

    expect(ModerationCase::query()->whereKey($case->id)->exists())->toBeFalse();
});
