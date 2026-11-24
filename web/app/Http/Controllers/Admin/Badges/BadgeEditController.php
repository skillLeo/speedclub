<?php

namespace App\Http\Controllers\Admin\Badges;

use App\Enums\BadgeCategory;
use App\Enums\BadgeMetric;
use App\Enums\BadgeTier;
use App\Http\Controllers\Admin\Support\ActivityFeed;
use App\Http\Controllers\Controller;
use App\Models\Badge;
use App\Models\DexSet;
use App\Models\Staff;
use App\Models\UserBadge;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-63 badge form (m5.9d contract §2): a new badge (content.edit) or one badge (content.view; the form is read-only without
 * content.edit). The rule is built from the whitelisted metrics (BadgeMetric: counting ones take "mindestens N", yes/no ones "ist
 * erfüllt", set_completed names a Dex set); the page asks PreviewBadgeRule how many members it would reach today. The activity column is
 * the badge's audit trail.
 */
class BadgeEditController extends Controller
{
    public function create(Request $request): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return Inertia::render('Badges/Edit', [...self::shared($staff), 'badge' => null, 'activity' => []]);
    }

    public function show(Request $request, string $badge): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $model = Badge::query()->find($badge);
        abort_unless($model instanceof Badge, 404);

        return Inertia::render('Badges/Edit', [
            ...self::shared($staff),
            'badge' => [
                'key' => $model->key,
                'name_de' => $model->name_de,
                'name_en' => $model->name_en,
                'description_de' => $model->description_de,
                'description_en' => $model->description_en,
                'hint_de' => $model->hint_de,
                'hint_en' => $model->hint_en,
                'rule' => $model->rule_json,
                'hidden' => $model->hidden,
                'tier' => $model->tier->value,
                'category' => $model->category->value,
                'sort' => $model->sort,
                'active' => $model->active,
                'earned' => UserBadge::query()->where('badge_key', $model->key)->count(),
            ],
            'activity' => fn (): array => ActivityFeed::for(['badge' => [$model->key]], $staff),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private static function shared(Staff $staff): array
    {
        return [
            'metrics' => array_map(fn (BadgeMetric $metric): array => ['key' => $metric->value, 'boolean' => $metric->isBoolean(), 'parameter' => $metric->parameter()], BadgeMetric::cases()),
            'sets' => array_values(DexSet::query()->orderBy('sort')->orderBy('key')->get()->map(fn (DexSet $set): array => ['key' => $set->key, 'name' => $set->name()])->all()),
            'tiers' => array_map(fn (BadgeTier $tier): string => $tier->value, BadgeTier::cases()),
            'categories' => array_map(fn (BadgeCategory $category): string => $category->value, BadgeCategory::cases()),
            'canEdit' => $staff->can('content.edit'),
        ];
    }
}
