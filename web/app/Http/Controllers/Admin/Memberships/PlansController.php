<?php

namespace App\Http\Controllers\Admin\Memberships;

use App\Actions\Admin\Memberships\SavePlan;
use App\Http\Controllers\Admin\Memberships\Requests\PlanRequest;
use App\Http\Controllers\Admin\Team\TeamResponses;
use App\Http\Controllers\Controller;
use App\Models\Entitlement;
use App\Models\MembershipPlan;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-F1 plans of the flagged memberships scaffold (06 §3, premium.enabled): name DE/EN, features DE/EN, active, how many members hold
 * each now. No price and no payment code in V1.
 */
class PlansController extends Controller
{
    use TeamResponses;

    public function index(): Response
    {
        return Inertia::render('Memberships/Plans', ['plans' => fn (): array => self::plans()]);
    }

    public function store(PlanRequest $request, SavePlan $save): RedirectResponse
    {
        return $this->step(fn () => $save->handle($request->staff(), null, $request->all(['key', 'name', 'features', 'active'])), 'memberships.flash.plan_created');
    }

    public function update(PlanRequest $request, string $plan, SavePlan $save): RedirectResponse
    {
        return $this->step(fn () => $save->handle($request->staff(), MembershipPlan::query()->findOrFail((int) $plan), $request->all(['name', 'features', 'active'])), 'memberships.flash.plan_saved');
    }

    /**
     * @return list<array<string, mixed>>
     */
    public static function plans(): array
    {
        $holders = Entitlement::query()->whereNull('revoked_at')->where('starts_at', '<=', now())
            ->where(fn ($q) => $q->whereNull('ends_at')->orWhere('ends_at', '>', now()))
            ->selectRaw('plan_id, COUNT(*) AS holders')->groupBy('plan_id')->pluck('holders', 'plan_id');

        return array_values(MembershipPlan::query()->orderBy('sort')->orderBy('id')->get()->map(fn (MembershipPlan $plan): array => [
            'id' => $plan->id,
            'key' => $plan->key,
            'name' => $plan->name,
            'features' => $plan->features,
            'active' => $plan->active,
            'holders' => (int) ($holders[$plan->id] ?? 0),
        ])->all());
    }
}
