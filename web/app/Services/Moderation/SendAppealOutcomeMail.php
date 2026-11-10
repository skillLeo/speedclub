<?php

namespace App\Services\Moderation;

use App\Mail\AppealDecidedMail;
use App\Models\Appeal;
use App\Models\User;
use App\Services\Auth\AuthMailer;
use App\Services\Notifications\NotificationTexts;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * The appeal outcome mail through the cron queue with retries (like SendDecisionMail): the appeal id only; the explanation is read from
 * the appeal at run time, the mail rendered in the appellant's language. Nothing when the account is gone.
 */
class SendAppealOutcomeMail implements ShouldQueue
{
    use Queueable;

    public int $tries = 4;

    public int $timeout = 40;

    public function __construct(public readonly string $appealId) {}

    /**
     * @return list<int>
     */
    public function backoff(): array
    {
        return [60, 300, 1800];
    }

    public function handle(AuthMailer $mailer, NotificationTexts $texts): void
    {
        $appeal = Appeal::query()->find($this->appealId);
        $member = $appeal?->appellant_id === null ? null : User::query()->find($appeal->appellant_id);

        if (! $appeal instanceof Appeal || ! $member instanceof User || $member->isDeactivated()) {
            return;
        }

        $mailer->send($member->email, $texts->locale($member), new AppealDecidedMail($appeal, (string) $appeal->outcome_explanation));
    }

    public function failed(?Throwable $exception): void
    {
        Log::error('An appeal outcome mail could not be sent.', ['appeal' => $this->appealId, 'type' => $exception === null ? null : $exception::class]);
    }
}
