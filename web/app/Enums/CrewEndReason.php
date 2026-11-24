<?php

namespace App\Enums;

/**
 * R4DQ-55: why the system (not the founder, not staff) ended a crew. Stored in crews.ended_reason with the soft delete, so ADM-80/81
 * can say "Beendet: kein Mitglied mehr" instead of "Vom Gründer gelöscht".
 */
enum CrewEndReason: string
{
    /** Nobody was left to run it: the last member's account was closed (C8), or CrewRepair found it without a member. */
    case NoMembers = 'no_members';
}
