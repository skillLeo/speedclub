<?php

namespace App\Enums;

/**
 * What can be reported (m2.6-contract §1). The id is the member's username for `member` (resolved to the account on receipt) and the
 * ULID of the row otherwise.
 */
enum ReportTargetType: string
{
    case Member = 'member';
    case Vehicle = 'vehicle';
    case Photo = 'photo';
    case Message = 'message';
    case BuildUpdate = 'build_update';
    case Modification = 'modification';
}
