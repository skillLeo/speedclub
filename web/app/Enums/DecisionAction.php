<?php

namespace App\Enums;

/**
 * ADM-21 decision composer: keine Maßnahme · Inhalt entfernen · Einschränken · Sperren. Every action but no_action restricts the
 * affected member and needs a statement of reasons to them (Art. 17 DSA).
 *
 * `reverse` (M3.2, m3.2-contract §1): lifts the restriction or brings back the content of an earlier decision
 * (decisions.reverses_decision_id): staff lifting a restriction or unhiding, and an upheld appeal (M3.4). It restricts nobody, but the
 * affected member is told, in the app and by e-mail, like any decision about them.
 */
enum DecisionAction: string
{
    case NoAction = 'no_action';
    case RemoveContent = 'remove_content';
    case Restrict = 'restrict';
    case Suspend = 'suspend';
    case Reverse = 'reverse';

    public function restrictsMember(): bool
    {
        return $this !== self::NoAction && $this !== self::Reverse;
    }

    /**
     * The affected member reads it (SAFE-01, SET-16) and is notified: every action but no_action, which they were never told about.
     */
    public function concernsMember(): bool
    {
        return $this !== self::NoAction;
    }
}
