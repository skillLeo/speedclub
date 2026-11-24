<?php

namespace App\Http\Controllers\Admin\Spots;

use App\Http\Controllers\Admin\Support\ActivityFeed;
use App\Http\Controllers\Controller;
use App\Models\Spot;
use App\Models\Staff;
use App\Services\Admin\Spots\SpotSignals;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-62 Spot record (SpotAdminRecord) with the spot's audit trail in the activity column (ActivityFeed). moderation.view; removed spots
 * stay readable here with who removed them.
 */
class SpotShowController extends Controller
{
    public function __invoke(Request $request, string $spot, SpotSignals $signals): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $model = Spot::withTrashed()->with(['spotter', 'city', 'vehicle' => fn ($v) => $v->with(['make', 'vehicleModel', 'generation', 'cover', 'owner:id,username'])])
            ->find(strtolower($spot));
        abort_if($model === null, 404);

        SpotAdminRecord::auditView($model, $staff);

        return Inertia::render('Spots/Show', [
            'spot' => SpotAdminRecord::detail($model, $staff, $signals),
            'activity' => fn (): array => ActivityFeed::for([$model->getMorphClass() => [$model->id]], $staff),
        ]);
    }
}
