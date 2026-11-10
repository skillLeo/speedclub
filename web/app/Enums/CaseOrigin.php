<?php

namespace App\Enums;

/**
 * How a moderation case began (m3.2-contract §1): with a report (M2.6), or on the staff's own initiative, which also covers the case a
 * `reverse` decision is recorded on. An own-initiative case has no report rows; DecideCase is still its only decider.
 */
enum CaseOrigin: string
{
    case Report = 'report';
    case Staff = 'staff';
}
