<?php

namespace App\Http\Controllers\Admin\Badges;

use App\Actions\Admin\Badges\ApplyBadge;
use App\Actions\Admin\Badges\PreviewBadgeRule;
use App\Actions\Admin\Badges\SaveBadge;
use App\Actions\Admin\Badges\SetBadgeActive;
use App\Http\Controllers\Admin\Badges\Requests\ApplyBadgeRequest;
use App\Http\Controllers\Admin\Badges\Requests\PreviewBadgeRequest;
use App\Http\Controllers\Admin\Badges\Requests\SaveBadgeRequest;
use App\Http\Controllers\Admin\Badges\Requests\SetBadgeActiveRequest;
use App\Http\Controllers\Controller;
use App\Models\Badge;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;

/**
 * ADM-63 writes (m5.9d contract §2, ADR-513): each one FormRequest (atom, text bounds) → the lane-B Action (atom again, rule validation,
 * audit `badge.*`). No four-eyes; ⚿ on every write (staff.recent-password, on the route). The preview is a read (JSON).
 */
class BadgeActionsController extends Controller
{
    public function store(SaveBadgeRequest $request, SaveBadge $save): RedirectResponse
    {
        $badge = $save->handle($request->staff(), null, $request->badgeInput());

        return redirect()->route('admin.badges.show', ['badge' => $badge->key], 303)->with('success', 'gift.badges.flash.created');
    }

    public function update(SaveBadgeRequest $request, string $badge, SaveBadge $save): RedirectResponse
    {
        $save->handle($request->staff(), self::find($badge), $request->badgeInput());

        return back(303)->with('success', 'gift.badges.flash.saved');
    }

    public function active(SetBadgeActiveRequest $request, string $badge, SetBadgeActive $set): RedirectResponse
    {
        $active = $request->boolean('active');
        $set->handle($request->staff(), self::find($badge), $active, $request->optionalReason());

        return back(303)->with('success', $active ? 'gift.badges.flash.activated' : 'gift.badges.flash.deactivated');
    }

    public function apply(ApplyBadgeRequest $request, string $badge, ApplyBadge $apply): RedirectResponse
    {
        $apply->handle($request->staff(), self::find($badge));

        return back(303)->with('success', 'gift.badges.flash.applied');
    }

    public function preview(PreviewBadgeRequest $request, PreviewBadgeRule $preview): JsonResponse
    {
        return response()->json(['data' => ['count' => $preview->handle($request->staff(), $request->rule())]]);
    }

    private static function find(string $key): Badge
    {
        $badge = Badge::query()->find($key);
        abort_unless($badge instanceof Badge, 404);

        return $badge;
    }
}
