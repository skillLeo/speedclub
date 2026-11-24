<?php

namespace App\Enums;

/**
 * R4-2.3: how a member gets into a crew. `open`: join at once; `request`: ask, founder or admins approve; `invite`: only by invitation.
 * An open invitation lets the member join in every mode.
 */
enum CrewJoinMode: string
{
    case Open = 'open';
    case Request = 'request';
    case Invite = 'invite';
}
