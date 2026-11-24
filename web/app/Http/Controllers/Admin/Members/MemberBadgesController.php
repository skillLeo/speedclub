<?php

namespace App\Http\Controllers\Admin\Members;

use App\Actions\Admin\Badges\RevokeBadge;
use App\Http\Controllers\Admin\Members\Requests\RevokeBadgeRequest;
use App\Http\Controllers\Admin\Support\RecordLookup;
use App\Http\Controllers\Controller;
use Illuminate\Http\RedirectResponse;

/** ADM-10 "Abzeichen entziehen" (SEC-P5G-05): RevokeBadge with the reason; ⚿ and moderation.decide on the route. */
class MemberBadgesController extends Controller
{
    public function revoke(RevokeBadgeRequest $request, string $member, string $badge, RevokeBadge $revoke): RedirectResponse
    {
        $revoke->handle($request->staff(), RecordLookup::member($member), $badge, $request->reason());

        return back(303)->with('success', 'members.badges.flash.revoked');
    }
}
