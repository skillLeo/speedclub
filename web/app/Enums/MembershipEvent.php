<?php

namespace App\Enums;

/** Audit actions of the flagged memberships scaffold (ADM-F1/F2, premium.enabled). */
enum MembershipEvent: string
{
    case PlanCreated = 'membership.plan_created';
    case PlanUpdated = 'membership.plan_updated';
    case EntitlementGranted = 'membership.entitlement_granted';
    case EntitlementRevoked = 'membership.entitlement_revoked';
}
