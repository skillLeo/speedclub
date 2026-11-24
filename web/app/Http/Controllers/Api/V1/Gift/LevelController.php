<?php

namespace App\Http\Controllers\Api\V1\Gift;

use App\Http\Controllers\Controller;
use App\Http\Resources\V1\MyLevelResource;
use App\Models\User;
use App\Services\Progress\LevelReport;
use Illuminate\Http\Request;

class LevelController extends Controller
{
    /**
     * My level.
     *
     * M5.9d (m5.9d contract §1, §10.1): level 1–10 with its title, XP, the XP of the next level (null on the top level), progress 0–1,
     * today's XP against the daily cap (Europe/Berlin day) and the fixed XP rules. XP comes from real actions only: never for likes,
     * reactions, posting volume or signing in.
     */
    public function show(Request $request, LevelReport $report): MyLevelResource
    {
        /** @var User $user */
        $user = $request->user();

        return new MyLevelResource($report->for($user));
    }
}
