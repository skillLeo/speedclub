<?php

namespace App\Enums;

/**
 * open → in_progress ⇄ waiting (identity or details asked from the requester) → completed | rejected. Completed and rejected are final
 * and need evidence (a note or a file).
 */
enum PrivacyRequestStatus: string
{
    case Open = 'open';
    case InProgress = 'in_progress';
    case Waiting = 'waiting';
    case Completed = 'completed';
    case Rejected = 'rejected';

    public function isFinal(): bool
    {
        return in_array($this, [self::Completed, self::Rejected], true);
    }

    /** @return list<self> */
    public static function openStates(): array
    {
        return [self::Open, self::InProgress, self::Waiting];
    }
}
