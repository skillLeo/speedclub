<?php

namespace App\Jobs\Engagement;

use App\Http\Controllers\Web\EmailUnsubscribeController;
use App\Mail\WeeklyRecapMail;
use App\Models\User;
use App\Models\WeeklyRecap;
use App\Services\Auth\AuthMailer;
use App\Services\Notifications\NotificationPrefs;
use App\Services\Notifications\NotificationTexts;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

/**
 * M5.7 (m5.7-contract §6.4, §7): one weekly recap e-mail through the database queue (one mail, well under 50 s). It reads the week's
 * recap row and asks the member's switch again right before sending, so an unsubscribe between the Sunday run and the worker wins.
 * Carries the recap row's id only (GarageSecurityAuditTest: queued jobs carry ids and nothing else).
 */
class SendWeeklyRecapMail implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    /** The WEB-UNSUB list of the recap (EmailUnsubscribeController::LISTS); the link stays valid this many days. */
    public const LIST = 'wochenrueckblick';

    public const LINK_DAYS = 60;

    public int $tries = 3;

    public int $timeout = 30;

    public function __construct(public readonly int $recapId) {}

    public function handle(AuthMailer $mailer, NotificationTexts $texts): void
    {
        $recap = WeeklyRecap::query()->find($this->recapId);
        $member = $recap === null ? null : User::query()->find($recap->user_id);

        if (! $member instanceof User || ! $member->isActive() || ! $member->hasVerifiedEmail()
            || ! (NotificationPrefs::for($member)['types']['weekly_recap']['email'] ?? false)) {
            return;
        }

        $mailer->send($member->email, $texts->locale($member), new WeeklyRecapMail($recap->payload ?? [], EmailUnsubscribeController::url(self::LIST, $member, self::LINK_DAYS)));
    }
}
