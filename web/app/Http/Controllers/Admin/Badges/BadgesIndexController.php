<?php

namespace App\Http\Controllers\Admin\Badges;

use App\Http\Controllers\Admin\Support\TableProps;
use App\Http\Controllers\Controller;
use App\Models\Badge;
use App\Models\DexSet;
use App\Models\Staff;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-63 "Abzeichen" (M5.9d admin, m5.9d contract §2, ADR-513): every badge with category, tier, hidden, active, earned count and sort.
 * content.view reads; creating, editing, (de)activating and "Jetzt anwenden" need content.edit (Owner, Admin, Content editor).
 */
class BadgesIndexController extends Controller
{
    public function __invoke(Request $request): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return Inertia::render('Badges/Index', [
            ...TableProps::make(BadgeListQuery::build($request), $request, BadgeListQuery::TABLE, $staff, BadgeListQuery::rows(...), BadgeListQuery::DEFAULT_SORT),
            'canEdit' => $staff->can('content.edit'),
            'anyBadges' => fn (): bool => Badge::query()->exists(),
            // The Dex set names a set_completed rule shows in words.
            'sets' => fn (): array => array_values(DexSet::query()->orderBy('sort')->orderBy('key')->get()->map(fn (DexSet $set): array => ['key' => $set->key, 'name' => $set->name()])->all()),
        ]);
    }
}
