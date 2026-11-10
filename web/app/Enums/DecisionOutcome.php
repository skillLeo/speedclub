<?php

namespace App\Enums;

/**
 * What a reporter learns of a decision (Art. 16(5) DSA, M2.6 review #2): whether the content stayed, went, or measures were taken
 * against the account. Never which measure: restrict and suspend both read as `measures`.
 */
enum DecisionOutcome: string
{
    case NoAction = 'no_action';
    case RemoveContent = 'remove_content';
    case Measures = 'measures';
    // M3.2: an earlier decision was lifted (a reverse decision). Reverse decisions sit on own-initiative cases, which have no reporters.
    case Reversed = 'reversed';

    public static function of(DecisionAction $action): self
    {
        return match ($action) {
            DecisionAction::NoAction => self::NoAction,
            DecisionAction::RemoveContent => self::RemoveContent,
            DecisionAction::Restrict, DecisionAction::Suspend => self::Measures,
            DecisionAction::Reverse => self::Reversed,
        };
    }
}
