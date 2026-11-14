<?php

namespace App\Enums;

/**
 * Staff decisions on business profiles (ADM-55/56, 09 §8.10), each written with Audit::record (reason included) and labelled in
 * lang/admin/{de,en}/audit.json. A suspension is four-eyes (business.suspend): its event names requester and approver.
 * SEC-414-01: the team's invitations and memberships too (the member actor, the business as target, the member's username).
 */
enum BusinessAuditEvent: string
{
    case Verified = 'business.verified';
    case Rejected = 'business.rejected';
    case Suspended = 'business.suspended';
    case Reinstated = 'business.reinstated';
    case Reopened = 'business.reopened';
    case MemberInvited = 'business.member_invited';
    case InviteAccepted = 'business.invite_accepted';
    case InviteDeclined = 'business.invite_declined';
    case InviteWithdrawn = 'business.invite_withdrawn';
    case MemberRemoved = 'business.member_removed';
    case MemberLeft = 'business.member_left';
}
