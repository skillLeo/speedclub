<?php

namespace App\Actions\Events\Checkin;

use App\Models\EventCheckin;

/**
 * M5.6 "Auf meinem Profil zeigen" and "War dabei entfernen": the member's own check-in, changed or taken back at any time (also after the
 * event, under a restriction or when the event was cancelled since).
 */
class UpdateCheckin
{
    public function visibility(EventCheckin $checkin, bool $visible): EventCheckin
    {
        $checkin->forceFill(['profile_visible' => $visible])->save();

        return $checkin;
    }

    public function remove(EventCheckin $checkin): void
    {
        $checkin->delete();
    }
}
