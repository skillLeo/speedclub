<?php

namespace App\Enums;

/**
 * Why a staff member who held `approvals.decide` lost approval rights (SEC-P5-01, ADR-507): the Owner-Override waits a cool-down after
 * each of these (ApproverChanges), so nobody can empty the approver list and override in one sitting.
 */
enum ApproverChangeCause: string
{
    /** Atoms removed from a role they hold (ADM-41/42). */
    case AtomsRemoved = 'atoms_removed';
    /** Their roles changed and atoms went (ADM-40). */
    case RolesChanged = 'roles_changed';
    case Deactivated = 'deactivated';
    /** Second factor reset: the account needs a new password and enrolment before it can approve again (ADR-238). */
    case TwoFactorReset = 'two_factor_reset';
}
