<?php

namespace App\Services\Approvals;

use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Carbon;

/**
 * The Owner-Override of a request the Owner may otherwise override (own pending request of a publishing action) is closed right now
 * (SF-4 of the M5.1 review): the controller answers with this message inside the dialog, not with the 403 page. `refusal` names why:
 *
 * - `off`: the governance switch of ADM-52 is off (or unreadable, SEC-P5-03);
 * - `approvers`: a second eligible approver exists now;
 * - `snapshot`: someone could approve it when it was asked (SEC-P5-01 a), or it was asked before that was recorded;
 * - `cooldown`: approval rights were taken from someone recently (SEC-P5-01 b), `until` says when the override may open;
 * - `lowers_protection`: the change makes a critical flag non-critical (SEC-P5-02), which always needs a second person.
 */
final class OwnerOverrideRefused extends AuthorizationException
{
    public const CODES = ['off', 'approvers', 'snapshot', 'cooldown', 'lowers_protection'];

    public function __construct(public readonly string $refusal, public readonly ?Carbon $until = null)
    {
        parent::__construct("No Owner-Override: $refusal.");
    }
}
