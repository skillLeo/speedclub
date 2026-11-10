<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Services\Garage\PublicMembers;
use App\Services\PublicPages\PublicPageData;
use App\Support\SignedInBrowser;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * WEB-02. Hidden members and a block with the signed-in browser answer the same 404 page. A name in other letter case is the same address, so it answers 301. A previous name answers 302 for its 14 days: it may
 * belong to somebody else later, so no browser may remember this redirect for good.
 */
class PublicMemberController extends Controller
{
    public function __invoke(Request $request, string $username, PublicMembers $members, PublicPageData $pages): Response
    {
        $member = $members->visibleTo(Viewer::from($request), $username);

        if ($member === null || SignedInBrowser::hasBlockWith($request, $member)) {
            return response()->view('public.state', ['state' => 'member_unavailable'], 404);
        }

        if ($member->username !== $username) {
            $status = $member->username === mb_strtolower(trim($username)) ? 301 : 302;
            // As on /v: ?lang=en and the QA overrides survive the redirect.
            $query = $request->getQueryString();

            return redirect('/u/'.$member->username.($query === null ? '' : '?'.$query), $status);
        }

        return response()->view('public.member', $pages->member($member, $request));
    }
}
