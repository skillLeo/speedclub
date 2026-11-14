<?php

namespace App\Http\Controllers\Admin\Editorial;

use App\Actions\Admin\Config\UpdateFeatureFlag;
use App\Actions\Admin\Editorial\HideSampleItem;
use App\Actions\Admin\Editorial\ShowSampleItem;
use App\Http\Controllers\Admin\Config\Support\ConfigAnswers;
use App\Http\Controllers\Admin\Editorial\Requests\SampleFlagRequest;
use App\Http\Controllers\Admin\Editorial\Requests\SampleItemRequest;
use App\Http\Controllers\Controller;
use App\Models\FeatureFlag;
use App\Services\Showcase\SampleContent;
use DomainException;
use Illuminate\Http\RedirectResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * ADM-58 writes, thin: hide or show one sample item (HideSampleItem / ShowSampleItem), and the editorial_samples flag of this
 * environment through UpdateFeatureFlag, so its rules hold here too (reason, `flag.changed` audit, four-eyes for a critical flag in
 * production).
 */
class EditorialActionsController extends Controller
{
    public function hide(SampleItemRequest $request, string $item, HideSampleItem $hide): RedirectResponse
    {
        try {
            $hide->handle($request->staff(), $request->type(), $item, $request->reason());
        } catch (DomainException $refused) {
            return back(303)->withErrors(['state' => 'editorial.errors.'.$refused->getMessage()]);
        }

        return back(303)->with('success', 'editorial.flash.hidden');
    }

    public function show(SampleItemRequest $request, string $item, ShowSampleItem $show): RedirectResponse
    {
        try {
            $restored = $show->handle($request->staff(), $request->type(), $item, $request->reason());
        } catch (DomainException $refused) {
            return back(303)->withErrors(['state' => 'editorial.errors.'.$refused->getMessage()]);
        }

        return $restored ? back(303)->with('success', 'editorial.flash.shown') : back(303)->with('error', 'editorial.flash.changed');
    }

    public function flag(SampleFlagRequest $request, UpdateFeatureFlag $update): Response
    {
        $flag = FeatureFlag::query()->where('key', SampleContent::FLAG)->first();
        abort_if($flag === null, 404);

        return ConfigAnswers::run($request, function () use ($request, $update, $flag) {
            $outcome = $update->handle($request->staff(), $flag, ['enabled' => $request->boolean('enabled')], $request->reason());

            return ConfigAnswers::outcome($outcome->approval, 'editorial.flash.flag');
        });
    }
}
