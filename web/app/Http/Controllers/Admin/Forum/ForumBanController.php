<?php

namespace App\Http\Controllers\Admin\Forum;

use App\Actions\Admin\Members\RestrictMember;
use App\Enums\RestrictionType;
use App\Http\Controllers\Admin\Forum\Requests\ForumBanRequest;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Services\Moderation\Statement;
use Illuminate\Http\RedirectResponse;
use InvalidArgumentException;

/**
 * ADM Forum "Forum-Sperre" (m5.8-contract D3): a DSA restriction of type forum through RestrictMember (own-initiative case, statement of
 * reasons by push and e-mail, appealable, liftable from ADM-10). Audited `moderation.decided`.
 */
class ForumBanController extends Controller
{
    public function __invoke(ForumBanRequest $request, string $member, RestrictMember $restrict): RedirectResponse
    {
        $user = preg_match('/^[0-9A-Za-z]{26}$/', $member) === 1 ? User::query()->find(strtolower($member)) : null;
        abort_unless($user instanceof User, 404);

        try {
            $restrict->handle($request->staff(), $user, RestrictionType::Forum, $request->until(), Statement::fromArray($request->validated()), $request->reason());
        } catch (InvalidArgumentException) {
            return back(303)->with('error', 'forum.flash.not_possible');
        }

        return back(303)->with('success', 'forum.flash.banned');
    }
}
