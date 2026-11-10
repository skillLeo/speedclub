<?php

namespace App\Http\Controllers\Admin\Members;

use App\Actions\Admin\Members\BulkMemberAction;
use App\Http\Controllers\Admin\Members\Requests\MemberBulkRequest;
use App\Http\Controllers\Admin\Support\ApprovalsGateway;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use Illuminate\Http\RedirectResponse;

/**
 * ADM-09 bulk (m3.1-contract §0): restrict and revoke sessions run at once for up to 100 members; more, and export or delete at any
 * count, become one approval request (`members.bulk`, four-eyes). The per-record rows go back in the session for the result panel.
 */
class MembersBulkController extends Controller
{
    public const FLASH = 'members_bulk';

    public function __invoke(MemberBulkRequest $request, BulkMemberAction $bulk): RedirectResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $action = $request->string('action')->value();
        /** @var array<string, mixed> $options */
        $options = $request->safe()->only(['type', 'until', 'facts', 'ground', 'ground_document', 'ground_section']);

        $outcome = $bulk->handle($staff, $action, (array) $request->validated('ids'), $request->string('reason')->value(), $options);

        if ($outcome->approval !== null) {
            return back(303)->with('approval', ApprovalsGateway::flash($outcome->approval));
        }

        $back = back(303)->with(self::FLASH, ['action' => $action, 'rows' => $outcome->rows]);

        return $outcome->counts()['failed'] === 0 ? $back->with('success', 'members.flash.bulk_done') : $back->with('error', 'members.flash.bulk_partial');
    }
}
