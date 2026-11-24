<?php

namespace App\Http\Controllers\Admin\Config;

use App\Actions\Admin\Config\UpdateFeatureFlag;
use App\Enums\ApprovalStatus;
use App\Http\Controllers\Admin\Config\Requests\FlagRequest;
use App\Http\Controllers\Admin\Config\Support\ConfigAnswers;
use App\Http\Controllers\Admin\Support\ApprovalsGateway;
use App\Http\Controllers\Controller;
use App\Models\ApprovalRequest;
use App\Models\FeatureFlag;
use App\Models\Staff;
use App\Services\Ai\AiGateway;
use Illuminate\Http\Request;
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
    public function index(Request $request, AiGateway $ai): Response
    {
        /** @var Staff $viewer */
        $viewer = $request->user('staff');
        $flags = FeatureFlag::query()->orderBy('key')->get();
        $pending = ApprovalRequest::query()->where('action', 'flags.critical_change')->where('status', ApprovalStatus::Pending)
            ->where('expires_at', '>', now())->where('subject_type', (new FeatureFlag)->getMorphClass())->latest()->get()->keyBy('subject_id');

        return Inertia::render('Config/Flags', [
            'flags' => array_values($flags->map(fn (FeatureFlag $flag): array => [
                'id' => (int) $flag->getKey(),
                'key' => (string) $flag->getAttribute('key'),
                ...UpdateFeatureFlag::state($flag),
                'ai' => str_starts_with((string) $flag->getAttribute('key'), 'ai.'),
                'pending' => $pending->has((string) $flag->getKey()),
                // M5.1: the waiting request of a critical flag, who can approve it, and whether the viewer may override it (ADR-507).
                'approval' => self::approval($pending->get((string) $flag->getKey()), $viewer),
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

        $wasHere = UpdateFeatureFlag::state($flag)['enabled'];

        return ConfigAnswers::run($request, function () use ($request, $update, $flag, $wasHere) {
            $outcome = $update->handle($request->staff(), $flag, $request->changes(), $request->reason());

            // M5.1: a change only to another environment's column changes nothing here (each environment has its own database, so the
            // other columns only record the intended state): the flash says so instead of "Flag geändert".
            $planned = $outcome->flag !== null && array_keys($request->changes()) === ['environments'] && UpdateFeatureFlag::state($outcome->flag)['enabled'] === $wasHere;

            return ConfigAnswers::outcome($outcome->approval, $planned ? 'config.flash.flag_planned' : 'config.flash.flag_changed');
        });
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function approval(?ApprovalRequest $request, Staff $viewer): ?array
    {
        return $request === null ? null : [
            'id' => $request->id,
            'title' => $request->summary['title'] ?? null,
            'expires_at' => $request->expires_at->toIso8601String(),
            'mine' => $request->requested_by === $viewer->getKey(),
            ...ApprovalsGateway::waiting($request, $viewer),
        ];
    }
}
