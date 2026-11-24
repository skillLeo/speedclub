<?php

namespace App\Http\Controllers\Api\V1\BuildScore;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\BuildScoreFormulaResource;
use App\Http\Resources\V1\BuildScoreResource;
use App\Http\Resources\V1\NoBuildScoreResource;
use App\Models\Vehicle;
use App\Services\BuildScore\BuildScores;
use App\Support\Viewer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * M5.9c Build Score (10 §16.3, m5.9c contract §4).
 */
class BuildScoreController extends Controller
{
    /**
     * A vehicle's Build Score.
     *
     * Guests too, for every vehicle the viewer may see (else 404 `vehicle_unavailable`). Total 0–1000, stage 1–5, the four parts, the
     * nightly ranks (only groups of at least 3 public cars), and, for the owner only, `previous_total` for "+25" and `next_upgrades`.
     * Computed at once the first time; after an edit it follows within about 30 seconds. `{"data": null}` while it cannot be computed.
     *
     * @unauthenticated
     */
    public function show(Request $request, string $vehicle, BuildScores $scores): BuildScoreResource|NoBuildScoreResource
    {
        $viewer = Viewer::from($request);
        $model = Vehicle::query()->with(['buildScore', 'owner'])->find(strtolower($vehicle));

        if (! $model instanceof Vehicle || ! Gate::forUser($viewer)->allows('view', $model)) {
            throw new ApiException(ErrorCode::VehicleUnavailable);
        }

        $read = $scores->read($model, $model->isOwnedBy($viewer));

        return $read === null ? new NoBuildScoreResource : new BuildScoreResource($read);
    }

    /**
     * How the Build Score is made.
     *
     * The formula of "So entsteht dein Build Score": the parts, their items with points, limits and caps, and the stages. Guests too.
     *
     * @unauthenticated
     */
    public function formula(BuildScores $scores): BuildScoreFormulaResource
    {
        return new BuildScoreFormulaResource($scores->formula());
    }
}
