<?php

namespace App\Services\Moderation;

use App\Enums\DecisionAction;
use App\Mail\DecisionReversedMail;
use App\Mail\ModerationDecisionMail;
use App\Models\Decision;
use App\Models\Report;
use App\Models\User;
use App\Services\Auth\AuthMailer;
use App\Services\Notifications\NotificationTexts;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * The mandatory statement-of-reasons mail (Art. 17 DSA, 02_PRODUCT_SPEC §7) through the cron queue, with retries (M2.6 review #6): a
 * failing mail server no longer loses it. Carries the decision id only; renders at run time in the member's language. Stamps
 * decisions.mailed_at once sent; notified_at stays the time of the decision notice (the in-app row), from which the appeal period runs.
 * A final failure is logged with the decision id and the exception class, never the content or the address; failed_jobs is scrubbed
 * (ScrubbingFailedJobProvider).
 */
class SendDecisionMail implements ShouldQueue
{
    use Queueable;

    public int $tries = 4;

    public int $timeout = 40;

    public function __construct(public readonly string $decisionId) {}

    /**
     * @return list<int> seconds before the 2nd, 3rd and 4th try
     */
    public function backoff(): array
    {
        return [60, 300, 1800];
    }

    public function handle(AuthMailer $mailer, NotificationTexts $texts): void
    {
        $decision = Decision::query()->with('case.firstReport')->find($this->decisionId);
        $subject = $decision?->subject_id === null ? null : User::query()->find($decision->subject_id);

        if (! $decision instanceof Decision || ! $subject instanceof User || $decision->mailed_at !== null || ! $decision->action->concernsMember()) {
            return;
        }

        $case = $decision->case;
        $first = $case?->firstReport;
        // An own-initiative case (M3.2) has no report: it names its target itself.
        $label = $first instanceof Report ? $first->target_label : $case?->target_label;

        $mail = $decision->action === DecisionAction::Reverse
            ? new DecisionReversedMail($decision, $decision->targetType(), $label)
            : new ModerationDecisionMail($decision, $decision->targetType(), $label, $case?->isOwnInitiative() ?? false);

        $mailer->send($subject->email, $texts->locale($subject), $mail);

        $decision->forceFill(['mailed_at' => now()])->save();
    }

    public function failed(?Throwable $exception): void
    {
        Log::error('A moderation decision mail could not be sent.', ['decision' => $this->decisionId, 'type' => $exception === null ? null : $exception::class]);
    }
}
