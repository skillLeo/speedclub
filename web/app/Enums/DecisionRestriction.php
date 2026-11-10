<?php

namespace App\Enums;

/**
 * The kind of a decision's restriction: what `restrict` takes away (messaging or publishing, RestrictionType) or `suspend`'s suspension.
 * The users.restrictions key of the same name holds it on the account.
 */
enum DecisionRestriction: string
{
    case Messaging = 'messaging';
    case Publishing = 'publishing';
    case Suspension = 'suspension';
}
