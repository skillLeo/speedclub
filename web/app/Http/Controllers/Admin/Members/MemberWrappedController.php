<?php

namespace App\Http\Controllers\Admin\Members;

use App\Actions\Wrapped\GenerateWrappedForUser;
use App\Http\Controllers\Admin\Members\Requests\GenerateWrappedRequest;
use App\Http\Controllers\Admin\Support\RecordLookup;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Models\Wrapped;
use App\Services\Wrapped\WrappedCardImages;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * ADM-10 tab "Wrapped" writes and images (m5.9e contract §2; atoms in MemberWrappedPanel). "Vorschau erzeugen" (⚿) runs
 * GenerateWrappedForUser (audited `wrapped.preview_generated`) and returns to the tab on that season. The card PNG is the member's card
 * as WrappedCardImages draws it for the member API, here behind the staff session only: `private, no-store`, never shared caches.
 */
class MemberWrappedController extends Controller
{
    public function generate(GenerateWrappedRequest $request, string $member, GenerateWrappedForUser $generate): RedirectResponse
    {
        $user = RecordLookup::member($member);
        $season = $request->seasonKey();
        $back = redirect()->route('admin.members.show', ['member' => $user->id, 'tab' => 'wrapped', 'season' => $season], 303);

        // A deleted account has nothing left to show; the generator would only write a row the deletion removes again.
        if ($user->trashed()) {
            return $back->with('error', 'members.wrapped.flash.closed');
        }

        // Without activity the generator removes a Wrapped the member had (as the nightly run would): the flash says so.
        $existed = Wrapped::query()->where('user_id', $user->id)->where('season_key', $season)->exists();
        $wrapped = $generate($request->staff(), $user, $season);

        return $back->with('success', match (true) {
            $wrapped !== null => 'members.wrapped.flash.generated',
            $existed => 'members.wrapped.flash.removed',
            default => 'members.wrapped.flash.nothing',
        });
    }

    public function card(Request $request, string $member, string $season, int $n, WrappedCardImages $images): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $user = RecordLookup::member($member);
        $wrapped = Wrapped::query()->where('user_id', $user->id)->where('season_key', $season)->first();
        abort_unless($wrapped instanceof Wrapped, 404);

        $wrapped->setRelation('user', $user);
        $card = $images->png($wrapped, $n);
        abort_if($card === null, 404);

        MemberWrappedPanel::auditView($user, $wrapped->season_key, $staff);

        return new Response($card['png'], 200, [
            'Content-Type' => 'image/png',
            'Content-Disposition' => 'inline; filename="wrapped-'.$wrapped->season_key.'-'.$n.'.png"',
            'Cache-Control' => 'private, no-store, max-age=0',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
