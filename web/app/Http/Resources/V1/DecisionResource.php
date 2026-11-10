<?php

namespace App\Http\Resources\V1;

use App\Enums\CaseOrigin;
use App\Enums\DecisionAction;
use App\Enums\DecisionOutcome;
use App\Enums\DecisionViewer;
use App\Enums\GroundDocument;
use App\Enums\RedressOption;
use App\Models\Appeal;
use App\Models\Decision;
use App\Models\ModerationCase;
use App\Models\Report;
use App\Support\Moderation\AppealDeadline;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * SAFE-01 (GET decisions/{id}), by viewer (m2.6-contract §2 and Addendum, M2.6 review #2, #11, #12):
 *
 * - `affected`: the full statement of reasons of Art. 17(3) DSA: the action and its restriction, the scope and duration (`scope`), the
 *   facts and the ground in the decider's words, where the ground is written (`ground_document`, `ground_section` for the link into
 *   SET-18), whether automated means found the content or took the decision, and the redress;
 * - `reporter`: the outcome only (Art. 16(5) DSA): `outcome` (no_action, remove_content or measures, never which measure), the two
 *   automation flags and the redress; `action`, `restriction`, `scope`, `statement`, `ground_document` and `ground_section` are null.
 *
 * `appeal_until` is the end of the appeal period per §§ 187, 188 BGB in Europe/Berlin (23:59:59 of that day, with its offset); the app
 * shows it as it is. `appeal` is the viewer's own appeal; `can_appeal` is false once they appealed or the period is over.
 * `dispute_settlement_url` leads to the list of certified out-of-court dispute settlement bodies (Art. 21 DSA).
 *
 * @property Decision $resource
 */
class DecisionResource extends JsonResource
{
    public function __construct(Decision $resource, private readonly DecisionViewer $viewer = DecisionViewer::Reporter, private readonly ?Appeal $appeal = null)
    {
        parent::__construct($resource);
    }

    /**
     * The target's name when it was first reported; needs case.firstReport loaded.
     */
    public static function labelOf(Decision $decision): ?string
    {
        $case = $decision->case;
        $first = $case instanceof ModerationCase && $case->relationLoaded('firstReport') ? $case->getRelation('firstReport') : null;

        // An own-initiative case (M3.2) has no report and names its target itself.
        return $first instanceof Report ? $first->target_label : ($case instanceof ModerationCase ? $case->target_label : null);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $decision = $this->resource;
        $affected = $this->viewer === DecisionViewer::Affected;
        $restriction = $decision->restrictionType();
        $reversal = $decision->action === DecisionAction::Reverse;
        // A reversal lifts a measure: there is nothing to appeal (M3.2).
        $until = $reversal ? null : $decision->appealUntil();
        $notified = $decision->notified_at;
        $case = $decision->case;

        return [
            'id' => $decision->id,
            /** @var DecisionViewer */
            'viewer' => $this->viewer,
            /** @var DecisionAction|null Affected member only; a reporter reads `outcome`. */
            'action' => $affected ? $decision->action : null,
            /** @var DecisionOutcome What came of it, for both viewers: no_action, remove_content, measures against the account, or reversed (an earlier measure lifted). */
            'outcome' => $decision->outcome(),
            /** @var CaseOrigin How the case began: a report, or staff acting on their own initiative (then nobody reported it). */
            'origin' => $case instanceof ModerationCase ? $case->origin : CaseOrigin::Report,
            /** @var string|null Affected member only: the decision this `reverse` decision lifted. */
            'reverses_decision_id' => $affected ? $decision->reverses_decision_id : null,
            /** @var array{type: 'messaging'|'publishing'|'suspension', until: string|null}|null Affected member only; restrict and suspend. */
            'restriction' => $affected && $restriction !== null
                ? ['type' => $restriction->value, 'until' => $decision->restrictionUntil()?->toIso8601String()]
                : null,
            /**
             * Affected member only, Art. 17(3)(a) DSA: what the decision applies to (the reported content, or the account) and until when
             * (null: no end date; removed content stays removed unless an appeal succeeds). Null for no_action.
             *
             * @var array{applies_to: 'content'|'account', until: string|null}|null
             */
            'scope' => $affected && $decision->action->restrictsMember()
                ? ['applies_to' => $decision->action === DecisionAction::RemoveContent ? 'content' : 'account', 'until' => $decision->restrictionUntil()?->toIso8601String()]
                : null,
            /** @var SafetyTargetResource */
            'target' => SafetyTargetResource::of($decision->targetType(), self::labelOf($decision)),
            /** ISO 8601. */
            'decided_at' => $decision->decided_at->toIso8601String(),
            /** @var string|null ISO 8601. When the members were told; the appeal period runs from here. */
            'notified_at' => $notified?->toIso8601String(),
            /** @var string|null ISO 8601 in Europe/Berlin, the last second of the last day of the appeal period. */
            'appeal_until' => $until?->toIso8601String(),
            /** Art. 17(3)(c) DSA: automated means found the content. */
            'automated_detection' => $decision->automatedDetection(),
            /** Art. 17(3)(c) DSA: automated means took the decision (never so far: a person decides). */
            'automated_decision' => $decision->automatedDecision(),
            /** @var list<RedressOption> */
            'redress' => $decision->redress(),
            /** The European Commission's list of certified out-of-court dispute settlement bodies (Art. 21 DSA). */
            'dispute_settlement_url' => config()->string('speedclub.legal.dispute_settlement_url'),
            /** @var GroundDocument|null Affected member only: community guidelines, terms or the law. */
            'ground_document' => $affected ? $decision->groundDocument() : null,
            /** @var string|null Affected member only: the section of that document ("3"), for the link into SET-18. */
            'ground_section' => $affected ? $decision->groundSection() : null,
            /** @var array{facts: string, ground: string}|null Affected member only: the decider's own words. */
            'statement' => $affected ? ['facts' => $decision->facts(), 'ground' => $decision->ground()] : null,
            /** @var AppealResource|null The viewer's own appeal. */
            'appeal' => $this->appeal === null ? null : new AppealResource($this->appeal),
            'can_appeal' => ! $reversal && $this->appeal === null && $notified !== null && AppealDeadline::isOpen($notified),
        ];
    }
}
