<?php

namespace App\Actions\Engagement;

use App\Models\User;
use App\Services\Notifications\NotificationPrefs;
use Illuminate\Support\Facades\DB;

/**
 * M5.7 (m5.7-contract §6.5): the unsubscribe link of the weekly recap e-mail, through the shared WEB-UNSUB page
 * (App\Http\Controllers\Web\EmailUnsubscribeController, list `wochenrueckblick`). Only `weekly_recap.email` goes off; the push and every
 * other choice stay as the member set them. Idempotent: a second click changes nothing (like M5.6's UnsubscribeNearbyEmail).
 */
class UnsubscribeFromRecap
{
    public function handle(User $member): void
    {
        DB::transaction(function () use ($member): void {
            /** @var User $locked */
            $locked = User::query()->whereKey($member->id)->lockForUpdate()->firstOrFail();
            /** @var mixed $stored */
            $stored = $locked->getAttribute('notification_prefs');
            $prefs = is_array($stored) ? $stored : [];
            $types = is_array($prefs['types'] ?? null) ? $prefs['types'] : [];
            $recap = is_array($types['weekly_recap'] ?? null) ? $types['weekly_recap'] : [];

            if (($recap['email'] ?? NotificationPrefs::TYPES['weekly_recap']['email']) === false) {
                return;
            }

            $types['weekly_recap'] = [...$recap, 'email' => false];
            $prefs['types'] = $types;
            $locked->forceFill(['notification_prefs' => $prefs])->save();
        });
    }
}
