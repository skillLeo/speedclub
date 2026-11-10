<?php

namespace App\Http\Controllers\Admin\Memberships;

use App\Actions\Admin\Memberships\ManageEntitlements;
use App\Http\Controllers\Admin\Memberships\Requests\EntitlementRequest;
use App\Http\Controllers\Admin\Support\QaClock;
use App\Http\Controllers\Admin\Team\TeamResponses;
use App\Http\Controllers\Controller;
use App\Models\Entitlement;
use App\Models\MembershipPlan;
use App\Models\Staff;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Validation\ValidationException;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-F2 entitlements (06 §3: "grant/revoke manually with reason and end date, audited"): member, plan, granted by, reason, start, end,
 * revoked (by whom, why). A revoked row stays as history. The status (aktiv, geplant, abgelaufen, widerrufen) is read here with the page's
 * clock (QaClock), never by the browser (DQ-617 class).
 */
class EntitlementsController extends Controller
{
    use TeamResponses;

    public function index(Request $request): Response
    {
        $now = QaClock::now($request);

        return Inertia::render('Memberships/Entitlements', [
            'entitlements' => fn (): array => self::rows($now),
            'plans' => fn (): array => array_map(fn (array $plan): array => ['id' => $plan['id'], 'name' => $plan['name'], 'active' => $plan['active']], PlansController::plans()),
        ]);
    }

    public function store(EntitlementRequest $request, ManageEntitlements $manage): RedirectResponse
    {
        $member = User::query()->where('username', ltrim(trim($request->string('member')->value()), '@'))->first();

        if (! $member instanceof User) {
            throw ValidationException::withMessages(['member' => [__('validation.exists', ['attribute' => __('validation.attributes.username')])]]);
        }

        $plan = MembershipPlan::query()->findOrFail($request->integer('plan_id'));
        $start = $request->filled('starts_at') ? Carbon::parse($request->string('starts_at')->value()) : null;
        $end = $request->filled('ends_at') ? Carbon::parse($request->string('ends_at')->value()) : null;

        return $this->step(fn () => $manage->grant($request->staff(), $member, $plan, $request->reason(), $start, $end), 'memberships.flash.granted');
    }

    public function revoke(EntitlementRequest $request, string $entitlement, ManageEntitlements $manage): RedirectResponse
    {
        return $this->step(fn () => $manage->revoke($request->staff(), Entitlement::query()->findOrFail($entitlement), $request->reason()), 'memberships.flash.revoked');
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function rows(CarbonImmutable $now): array
    {
        $rows = Entitlement::query()->with(['member:id,username,deleted_at', 'plan:id,name'])->latest('starts_at')->limit(200)->get();
        $staffIds = $rows->pluck('granted_by')->merge($rows->pluck('revoked_by'))->filter()->unique()->values()->all();
        $names = Staff::query()->whereIn('id', $staffIds)->pluck('name', 'id');

        return array_values($rows->map(fn (Entitlement $row): array => [
            'id' => $row->id,
            'member' => ['id' => $row->member->id, 'username' => $row->member->username],
            'plan' => ['id' => $row->plan->id, 'name' => $row->plan->name],
            'granted_by' => $row->granted_by === null ? null : ($names[$row->granted_by] ?? null),
            'reason' => $row->reason,
            'starts_at' => $row->starts_at->toIso8601String(),
            'ends_at' => $row->ends_at?->toIso8601String(),
            'revoked_at' => $row->revoked_at?->toIso8601String(),
            'revoked_by' => $row->revoked_by === null ? null : ($names[$row->revoked_by] ?? null),
            'revoke_reason' => $row->revoke_reason,
            'status' => match (true) {
                $row->revoked_at !== null => 'revoked',
                $row->starts_at->greaterThan($now) => 'scheduled',
                $row->ends_at !== null && $row->ends_at->lessThanOrEqualTo($now) => 'ended',
                default => 'active',
            },
        ])->all());
    }
}
