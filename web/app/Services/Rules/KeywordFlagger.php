<?php

namespace App\Services\Rules;

use App\Actions\Moderation\SubmitReport;
use App\Enums\KeywordField;
use App\Enums\ReportReason;
use App\Enums\ReportSource;
use App\Models\BuildUpdate;
use App\Models\Message;
use App\Models\ModerationCase;
use App\Models\Report;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Moderation\ReportDraft;
use App\Services\Moderation\ReportTargets;
use Throwable;

/**
 * Files the automated notice of a flag-list match (source `automated`, no reporter): it joins or opens the content's case, which the
 * queue marks as automated detection. One automated notice per open case: a member editing the same text again adds nothing. The
 * details name the field and the matched terms (staff need them to judge), never the text. A failure is reported and never fails the
 * member's write.
 */
class KeywordFlagger
{
    public function __construct(
        private readonly SubmitReport $submit,
        private readonly ReportTargets $targets,
    ) {}

    /**
     * @param  list<array{field: KeywordField, rules: list<array{id: int, term: string, list: string}>}>  $flags
     */
    public function flag(User|Vehicle|BuildUpdate|Message $target, array $flags): void
    {
        try {
            $resolved = $this->targets->forStaff($target);
            $open = ModerationCase::query()->where('open_target', ModerationCase::openKey($resolved->type, $resolved->id()))->value('id');

            if (is_string($open) && Report::query()->where('case_id', $open)->where('source', ReportSource::Automated->value)->exists()) {
                return;
            }

            $terms = [];
            foreach ($flags as $flag) {
                foreach ($flag['rules'] as $rule) {
                    $terms[] = $flag['field']->value.': '.$rule['term'];
                }
            }

            $this->submit->handle($resolved, new ReportDraft(
                source: ReportSource::Automated,
                reporter: null,
                reason: ReportReason::Other,
                details: mb_substr('Schlagwortregel: '.implode(', ', array_unique($terms)), 0, 1000),
            ));
        } catch (Throwable $exception) {
            report($exception);
        }
    }
}
