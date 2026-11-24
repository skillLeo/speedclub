<?php

namespace App\Http\Resources\V1;

use App\Enums\BadgeCategory;
use App\Enums\BadgeTier;
use App\Models\Badge;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A badge (m5.9d contract §2, §10.2) for the member's own list (earned or not) or another member's (earned only). A hidden badge the
 * member has not earned reads `hidden: true` with its hint only ("???"): name and description null.
 *
 * @property array{badge: Badge, earned_at: CarbonInterface|null} $resource
 */
class BadgeResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $badge = $this->resource['badge'];
        $earned = $this->resource['earned_at'];
        $secret = $badge->hidden && $earned === null;
        $locale = app()->getLocale();

        return [
            'key' => $badge->key,
            /** A hidden badge not earned yet: show "???" and the hint. */
            'hidden' => $secret,
            /** @var string|null Null while hidden. */
            'name' => $secret ? null : $badge->name($locale),
            /** @var string|null Null while hidden. */
            'description' => $secret ? null : $badge->description($locale),
            /** @var string|null The hint of a hidden badge (also once earned); null for the others. */
            'hint' => $badge->hidden ? $badge->hint($locale) : null,
            /** @var BadgeTier */
            'tier' => $badge->tier,
            /** @var BadgeCategory */
            'category' => $badge->category,
            /** @var string|null When the member earned it; null when not (yet). */
            'earned_at' => $earned?->toIso8601String(),
            'sort' => (int) $badge->sort,
        ];
    }
}
