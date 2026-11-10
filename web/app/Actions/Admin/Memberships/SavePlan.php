<?php

namespace App\Actions\Admin\Memberships;

use App\Enums\MembershipEvent;
use App\Models\MembershipPlan;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Memberships\Memberships;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * ADM-F1 create or edit a plan (`memberships.manage`, premium.enabled): key (slug, fixed once created), name DE (EN optional), features
 * DE/EN (≤ 20 lines of ≤ 160), active. No price: V1 has no payment code.
 *
 * @throws AuthorizationException|ValidationException|NotFoundHttpException
 */
class SavePlan
{
    public function __construct(private readonly Memberships $memberships) {}

    /**
     * @param  array<string, mixed>  $input  key, name {de, en}, features {de: [], en: []}, active, sort
     */
    public function handle(Staff $by, ?MembershipPlan $plan, array $input): MembershipPlan
    {
        $this->memberships->ensureEnabled();
        StaffAtoms::ensure($by, 'memberships.manage');

        $data = Validator::make($input, [
            'key' => [$plan === null ? 'required' : 'prohibited', 'string', 'max:64', 'regex:/\A[a-z0-9][a-z0-9-]*\z/', Rule::unique('membership_plans', 'key')],
            'name' => ['required', 'array'],
            'name.de' => ['required', 'string', 'max:80'],
            'name.en' => ['nullable', 'string', 'max:80'],
            'features' => ['present', 'array'],
            'features.de' => ['present', 'array', 'max:20'],
            'features.de.*' => ['string', 'min:1', 'max:160'],
            'features.en' => ['nullable', 'array', 'max:20'],
            'features.en.*' => ['string', 'min:1', 'max:160'],
            'active' => ['required', 'boolean'],
            'sort' => ['nullable', 'integer', 'between:0,1000'],
        ])->validate();

        return DB::transaction(function () use ($by, $plan, $data): MembershipPlan {
            $created = $plan === null;
            $plan ??= new MembershipPlan;
            $before = $created ? null : $plan->only(['name', 'features', 'active', 'sort']);

            $plan->forceFill([
                'name' => ['de' => trim($data['name']['de']), 'en' => isset($data['name']['en']) ? trim((string) $data['name']['en']) : null],
                'features' => [
                    'de' => array_values(array_map(trim(...), $data['features']['de'])),
                    'en' => array_values(array_map(trim(...), $data['features']['en'] ?? [])),
                ],
                'active' => (bool) $data['active'],
                'sort' => (int) ($data['sort'] ?? $plan->sort ?? 0),
            ]);

            if ($created) {
                $plan->forceFill(['key' => $data['key']]);
            }

            $plan->save();

            Audit::record(($created ? MembershipEvent::PlanCreated : MembershipEvent::PlanUpdated)->value, $plan,
                before: $before, after: $plan->only(['key', 'name', 'features', 'active', 'sort']), actor: $by);

            return $plan;
        });
    }
}
