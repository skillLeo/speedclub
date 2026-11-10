<?php

namespace App\Http\Controllers\Admin\Config;

use App\Actions\Admin\Config\UpdateFeatureFlag;
use App\Enums\ApprovalStatus;
use App\Http\Controllers\Admin\Config\Requests\FlagRequest;
use App\Http\Controllers\Admin\Config\Support\ConfigAnswers;
use App\Http\Controllers\Controller;
use App\Models\ApprovalRequest;
use App\Models\FeatureFlag;
use App\Services\Ai\AiGateway;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpFoundation\Response as HttpResponse;

/**
 * ADM-36 Feature-Flags (06 §3, m3.5 §2): every flag with its state per environment, team-only rollout, percentage rollout for member
 * flags and the critical marker. A change ⚿ needs a reason; a critical flag in production is four-eyes (`flags.critical_change`); an
 * `ai.*` flag cannot be switched on without an AI provider ("Kein KI-Anbieter konfiguriert").
 */
class FlagsController extends Controller
{
    public function index(AiGateway $ai): Response
    {
        $flags = FeatureFlag::query()->orderBy('key')->get();
        $pending = ApprovalRequest::query()->where('action', 'flags.critical_change')->where('status', ApprovalStatus::Pending)
            ->where('subject_type', (new FeatureFlag)->getMorphClass())->pluck('subject_id')->all();

        return Inertia::render('Config/Flags', [
            'flags' => array_values($flags->map(fn (FeatureFlag $flag): array => [
                'id' => (int) $flag->getKey(),
                'key' => (string) $flag->getAttribute('key'),
                ...UpdateFeatureFlag::state($flag),
                'ai' => str_starts_with((string) $flag->getAttribute('key'), 'ai.'),
                'pending' => in_array((string) $flag->getKey(), $pending, true),
                'updated_at' => $flag->updated_at?->toIso8601String(),
            ])->all()),
            'environment' => UpdateFeatureFlag::environment(),
            'production' => app()->environment('production'),
            'aiAvailable' => $ai->available(),
        ]);
    }

    public function update(FlagRequest $request, UpdateFeatureFlag $update): HttpResponse
    {
        $flag = FeatureFlag::query()->find((int) $request->route('flag'));
        abort_if($flag === null, 404);

        return ConfigAnswers::run($request, function () use ($request, $update, $flag) {
            $outcome = $update->handle($request->staff(), $flag, $request->changes(), $request->reason());

            return ConfigAnswers::outcome($outcome->approval, 'config.flash.flag_changed');
        });
    }
}
