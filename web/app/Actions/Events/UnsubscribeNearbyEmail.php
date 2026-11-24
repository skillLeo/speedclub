<?php

namespace App\Actions\Events;

use App\Models\User;
use App\Services\Notifications\NotificationPrefs;
use Illuminate\Support\Facades\DB;

/**
 * M5.6 (m5.6-contract §6): the one-click unsubscribe of the weekly nearby e-mail. Only `event_nearby.email` goes off; the push and every
 * other choice stay as the member set them. Idempotent: a second click changes nothing.
 */
class UnsubscribeNearbyEmail
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
            $nearby = is_array($types['event_nearby'] ?? null) ? $types['event_nearby'] : [];

            if (($nearby['email'] ?? NotificationPrefs::TYPES['event_nearby']['email']) === false) {
                return;
            }

            $types['event_nearby'] = [...$nearby, 'email' => false];
            $prefs['types'] = $types;
            $locked->forceFill(['notification_prefs' => $prefs])->save();
        });
    }
}
