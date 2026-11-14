<?php

namespace App\Http\Controllers\Admin\Editorial;

use App\Actions\Admin\Config\UpdateFeatureFlag;
use App\Enums\ApprovalStatus;
use App\Enums\SampleItemType;
use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\ApprovalRequest;
use App\Models\FeatureFlag;
use App\Models\Staff;
use App\Services\Showcase\SampleContent;
use App\Services\Showcase\SampleInventory;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-58 Editorial & Beispiele (09 §8.19, §10.3): the editorial_samples flag per environment (this one takes effect; production stays off
 * until the client supplies real, consented builds), what sample content exists, and the sample builds, meets and businesses in tabs
 * with their state for members. `content.view` reads; hiding or showing an item needs `content.edit` and the flag `flags.manage`.
 */
class EditorialController extends Controller
{
    public function __invoke(Request $request): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $type = SampleItemType::tryFrom(is_string($request->query('tab')) ? $request->query('tab') : '') ?? SampleItemType::Vehicle;

        return Inertia::render('Editorial/Index', [
            ...TableProps::make(SampleItems::build($type, $request), $request, SampleItems::TABLE.'-'.$type->value, $staff,
                fn (array $items): array => SampleItems::rows($type, $items), SampleItems::DEFAULT_SORT),
            'tab' => $type->value,
            'environment' => UpdateFeatureFlag::environment(),
            'flag' => fn (): ?array => self::flag(),
            'summary' => fn (): array => SampleItems::summary(),
            'editorial' => fn (): ?array => SampleInventory::editorialAccount(),
            'canEdit' => $staff->can('content.edit'),
            'canToggle' => $staff->can('flags.manage'),
        ]);
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function flag(): ?array
    {
        $flag = FeatureFlag::query()->where('key', SampleContent::FLAG)->first();

        if ($flag === null) {
            return null;
        }

        $pending = ApprovalRequest::query()->where('action', 'flags.critical_change')->where('status', ApprovalStatus::Pending)
            ->where('subject_type', $flag->getMorphClass())->where('subject_id', (string) $flag->getKey())->exists();

        return ['id' => (int) $flag->getKey(), ...UpdateFeatureFlag::state($flag), 'pending' => $pending, 'updated_at' => $flag->updated_at?->toIso8601String()];
    }
}
