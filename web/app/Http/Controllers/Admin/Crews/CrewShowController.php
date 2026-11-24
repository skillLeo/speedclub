<?php

namespace App\Http\Controllers\Admin\Crews;

use App\Http\Controllers\Admin\Support\ActivityFeed;
use App\Http\Controllers\Controller;
use App\Models\Crew;
use App\Models\Staff;
use App\Services\Moderation\ModerationHolds;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-81 crew record (R4-2.3, contract-crews.md §6): header with state and the Staff actions, about (description, logo, cover, facts,
 * open requests/invites), the member list with roles, the moderation cases on the crew, and the activity column from the audit log
 * (crew.* and the decisions). Deleted crews open too.
 */
class CrewShowController extends Controller
{
    public function __invoke(Request $request, Crew $crew, ModerationHolds $holds): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return Inertia::render('Crews/Show', [
            'crew' => fn (): array => CrewAdminRecord::detail($crew, $holds),
            'members' => fn (): array => CrewAdminRecord::members($crew),
            'cases' => fn (): array => CrewAdminRecord::cases($crew),
            'activity' => fn (): array => ActivityFeed::for(CrewAdminRecord::targets($crew), $staff),
        ]);
    }
}
