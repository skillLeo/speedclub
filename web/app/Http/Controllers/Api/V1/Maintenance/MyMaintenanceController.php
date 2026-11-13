<?php

namespace App\Http\Controllers\Api\V1\Maintenance;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\V1\Maintenance\UpcomingRequest;
use App\Http\Resources\V1\MaintenanceReminderPlanResource;
use App\Http\Resources\V1\MaintenanceUpcomingResource;
use App\Models\User;
use App\Services\Maintenance\MaintenanceOverview;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Across the member's vehicles (09 §8.8): Garage "Nächste Fälligkeiten", the Android widget and the local reminder plan read the same data.
 */
class MyMaintenanceController extends Controller
{
    /**
     * Upcoming maintenance.
     *
     * Overdue items first, then those due within `days` (default 60) or within 1,000 km, each with its vehicle. At most `limit` (20).
     */
    public function upcoming(UpcomingRequest $request, MaintenanceOverview $overview): AnonymousResourceCollection
    {
        /** @var User $user */
        $user = $request->user();

        return MaintenanceUpcomingResource::collection($overview->upcoming($user, (int) ($request->validated('days') ?? 60), (int) ($request->validated('limit') ?? 20)));
    }

    /**
     * Reminder plan.
     *
     * The dedupe contract of 09 §8.8: every reminder stage of the member's reminding items. `key` is deterministic; the app gives its
     * local backup notification that id, schedules it only for `planned` date stages (at or after `fire_at`), and drops it once a push
     * carries the same `reminder_key` or this list says `sent`/`skipped`. km stages have no date: only the server sends them.
     */
    public function reminders(Request $request, MaintenanceOverview $overview): MaintenanceReminderPlanResource
    {
        /** @var User $user */
        $user = $request->user();

        return new MaintenanceReminderPlanResource($overview->reminderPlan($user));
    }
}
