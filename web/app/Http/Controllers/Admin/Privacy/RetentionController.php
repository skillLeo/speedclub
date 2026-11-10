<?php

namespace App\Http\Controllers\Admin\Privacy;

use App\Actions\Admin\Privacy\UpdateRetention;
use App\Enums\ConfigKey;
use App\Enums\ConfigVersionStatus;
use App\Http\Controllers\Admin\Privacy\Requests\RetentionRequest;
use App\Http\Controllers\Admin\Team\TeamResponses;
use App\Http\Controllers\Controller;
use App\Models\ConfigVersion;
use App\Models\Staff;
use App\Services\Privacy\RetentionPolicy;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-47 retention (06 §4, m3.6 §1, ADR-239): every period with its unit and, for the editable ones, the bounds (never below the legal or
 * product minimum, never above what the privacy policy promises) and the default; the fixed ones read-only. Saving needs retention.manage,
 * a reason and a recent password; it publishes a new version of the config key `retention` (audited by the engine).
 */
class RetentionController extends Controller
{
    use TeamResponses;

    public function show(Request $request, RetentionPolicy $policy): Response
    {
        /** @var Staff $viewer */
        $viewer = $request->user('staff');
        $last = ConfigVersion::query()->where('key', ConfigKey::Retention->value)->where('status', ConfigVersionStatus::Published)->orderByDesc('version')->with('publisher:id,name')->first();

        return Inertia::render('Privacy/Retention', [
            'periods' => fn (): array => $policy->catalogue(),
            'lastPublished' => $last === null ? null : [
                'version' => $last->version,
                'at' => $last->published_at?->toIso8601String(),
                'by' => $last->publisher?->name,
            ],
            'canEdit' => $viewer->can('retention.manage'),
        ]);
    }

    public function update(RetentionRequest $request, UpdateRetention $update): RedirectResponse
    {
        /** @var array<string, int|null> $periods */
        $periods = array_map(fn (mixed $value): ?int => $value === null || $value === '' ? null : (int) $value, $request->array('periods'));

        return $this->step(fn () => $update->handle($request->staff(), array_filter($periods, fn (?int $value): bool => $value !== null), $request->reason()), 'privacy.flash.retention_saved');
    }
}
