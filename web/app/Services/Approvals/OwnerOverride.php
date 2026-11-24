<?php

namespace App\Services\Approvals;

use App\Actions\Admin\Config\UpdateFeatureFlag;
use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Models\ApprovalRequest;
use App\Models\ConfigVersion;
use App\Models\FeatureFlag;
use App\Models\Staff;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\Collection;
use Throwable;

/**
 * ADR-507 (10_CLIENT_ROUND_1 §9): the Owner-Override of a four-eyes request. A publishing change that needs a second person (a critical
 * flag in production, maintenance on, a legal text with re-consent) waited forever when nobody else could approve it. The requesting
 * Owner may then execute it themselves with a reason, recorded as `approval.owner_override` and mailed (StaffAlerts) to every active
 * Owner and Admin and everyone who approved a request in the last 90 days, when all of:
 *
 * - the action is one of ACTIONS (publishing; never member, staff, export or bulk actions);
 * - the request is pending, not expired, and was asked by this staff member, who is an active Owner;
 * - the governance switch (`governance.owner_override`, ADM-52, default on) allows it; a published value that is not `true` reads as off
 *   (SEC-P5-03, fail closed);
 * - the change does not lower a protection: a critical flag never becomes non-critical by override (SEC-P5-02);
 * - nobody else could approve it now (Approvals::eligibleApprovers() is empty) AND nobody could when it was asked
 *   (`eligible_at_request` is an empty list, SEC-P5-01 a);
 * - no staff action took approval rights from anyone within the cool-down (ApproverChanges, SEC-P5-01 b).
 *
 * The first group (action, requester, Owner) refuses with AuthorizationException (403: never this person's override). The rest refuses
 * with OwnerOverrideRefused, which the page shows inside the override dialog. Approvals::overrideByOwner() checks again inside the
 * request's row lock, with the governance row share-locked (SEC-P5-05).
 */
final class OwnerOverride
{
    /** The publishing actions an Owner may override. */
    public const ACTIONS = ['flags.critical_change', 'maintenance.enable', 'legal.publish_reconsent'];

    public function __construct(private readonly Approvals $approvals, private readonly ApproverChanges $changes) {}

    /**
     * The governance switch of ADM-52: on when no version was ever published (the schema default), otherwise only a published
     * `owner_override: true`. A payload of another shape or a failed read is off (SEC-P5-03). $lock: share-lock the live row (inside the
     * override's transaction, so a parallel "off" waits for it or wins before it, SEC-P5-05).
     */
    public function enabled(bool $lock = false): bool
    {
        try {
            $query = ConfigVersion::query()->where('key', ConfigKey::Governance->value)->where('status', ConfigVersionStatus::Published)->orderByDesc('version');
            $live = ($lock ? $query->sharedLock() : $query)->first();
        } catch (Throwable) {
            return false;
        }

        if ($live === null) {
            return true;
        }

        // Read untyped: a hand-edited or future row may hold anything.
        $payload = $live->getAttribute('payload');

        return is_array($payload) && ($payload['owner_override'] ?? null) === true;
    }

    /**
     * @param  Collection<int, Staff>|null  $approvers  Approvals::eligibleApprovers($request) when the caller has it already
     *
     * @throws AuthorizationException|OwnerOverrideRefused
     */
    public function ensureAllowed(ApprovalRequest $request, Staff $staff, ?Collection $approvers = null, bool $lock = false): void
    {
        $eligibleCaller = in_array($request->action, self::ACTIONS, true)
            && $request->isPending()
            && ! $request->hasExpired()
            && $request->requested_by === $staff->getKey()
            && $staff->isActive()
            && $staff->isOwner();

        if (! $eligibleCaller) {
            throw new AuthorizationException('No Owner-Override: only the requesting Owner, for a pending publishing request.');
        }

        if (! $this->enabled($lock)) {
            throw new OwnerOverrideRefused('off');
        }

        if (self::lowersProtection($request)) {
            throw new OwnerOverrideRefused('lowers_protection');
        }

        if (($approvers ?? $this->approvals->eligibleApprovers($request))->isNotEmpty()) {
            throw new OwnerOverrideRefused('approvers');
        }

        if ($request->eligible_at_request !== []) {
            throw new OwnerOverrideRefused('snapshot');
        }

        $until = $this->changes->cooldownUntil();

        if ($until !== null) {
            throw new OwnerOverrideRefused('cooldown', $until);
        }
    }

    /**
     * @param  Collection<int, Staff>|null  $approvers
     */
    public function availableFor(ApprovalRequest $request, Staff $staff, ?Collection $approvers = null): bool
    {
        try {
            $this->ensureAllowed($request, $staff, $approvers);
        } catch (AuthorizationException) {
            return false;
        }

        return true;
    }

    /**
     * What a pending request's notice says (ADR-507): who can approve it (at most 5 names, only for its requester and for staff who
     * decide approvals themselves, SEC-P5-06; the count for everyone) and whether this staff member may override it. One eligibility
     * query per request.
     *
     * @return array{approvers: list<string>, approvers_total: int, override: bool}
     */
    public function status(ApprovalRequest $request, Staff $viewer): array
    {
        $approvers = $this->approvals->eligibleApprovers($request);
        $mayName = $request->requested_by === $viewer->getKey() || $viewer->can('approvals.decide');

        return [
            'approvers' => $mayName ? array_values($approvers->take(5)->map(fn (Staff $staff): string => (string) $staff->name)->all()) : [],
            'approvers_total' => $approvers->count(),
            'override' => $approvers->isEmpty() && $this->availableFor($request, $viewer, $approvers),
        ];
    }

    /**
     * SEC-P5-02: the change makes a critical flag non-critical. Lowering a protection always needs a second person.
     */
    public static function lowersProtection(ApprovalRequest $request): bool
    {
        if ($request->action !== 'flags.critical_change') {
            return false;
        }

        $payload = $request->payload;
        $changes = is_array($payload['changes'] ?? null) ? $payload['changes'] : [];
        $flag = FeatureFlag::query()->find((int) ($payload['flag_id'] ?? 0));

        if (! array_key_exists('critical', $changes)) {
            return false;
        }

        $critical = filter_var($changes['critical'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);

        // A flag that is critical now (or is gone: refuse rather than guess) and would not be afterwards.
        return $critical !== true && ($flag === null || UpdateFeatureFlag::state($flag)['critical']);
    }
}
