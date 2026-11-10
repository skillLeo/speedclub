<?php

namespace App\Http\Controllers\Admin\Members;

use App\Actions\Admin\Members\EndViewAs;
use App\Actions\Admin\Members\StartViewAs;
use App\Http\Controllers\Admin\Members\Requests\StartViewAsRequest;
use App\Http\Controllers\Admin\Support\RecordLookup;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use App\Services\Admin\Members\MemberRecord;
use DomainException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * ADM-10 answers that carry something that must never sit in a page prop, a flash or the session (SF-8, SF-2): plain JSON with
 * no-store, refused to an Inertia visit (409), so the value lives only in the page's memory until it navigates.
 *
 * - startViewAs: the one-time view-as URL (its token in the fragment) the page opens in a new tab;
 * - endViewAs: ends this staff member's view-as of the member;
 * - revealPii: the unmasked address (`members.view_pii`), audited `member.pii_viewed` by MemberRecord.
 */
class MemberJsonController extends Controller
{
    public function startViewAs(StartViewAsRequest $request, string $member, StartViewAs $start): JsonResponse
    {
        self::refuseInertia($request);

        try {
            $result = $start->handle($request->staff(), RecordLookup::member($member), $request->reason(), $request->boolean('member_consented'));
        } catch (DomainException) {
            return self::json(['code' => 'not_possible'], 422);
        }

        return self::json(['url' => $result['url'], 'expires_at' => $result['expires_at']]);
    }

    public function endViewAs(Request $request, string $member, EndViewAs $end): JsonResponse
    {
        self::refuseInertia($request);
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return self::json(['ended' => $end->byStaff($staff, RecordLookup::member($member))]);
    }

    public function revealPii(Request $request, string $member, MemberRecord $record): JsonResponse
    {
        self::refuseInertia($request);
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return self::json($record->revealPii(RecordLookup::member($member), $staff));
    }

    private static function refuseInertia(Request $request): void
    {
        abort_if($request->header('X-Inertia') !== null, 409);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private static function json(array $data, int $status = 200): JsonResponse
    {
        return response()->json($data, $status, ['Cache-Control' => 'no-store, private', 'Pragma' => 'no-cache']);
    }
}
