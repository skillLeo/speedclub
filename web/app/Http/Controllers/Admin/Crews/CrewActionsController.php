<?php

namespace App\Http\Controllers\Admin\Crews;

use App\Actions\Crews\Staff\HideCrew;
use App\Actions\Crews\Staff\RemoveCrew;
use App\Actions\Crews\Staff\RestoreCrew;
use App\Actions\Crews\Staff\UnhideCrew;
use App\Http\Controllers\Admin\Crews\Requests\CrewReasonRequest;
use App\Http\Controllers\Admin\Crews\Requests\HideCrewRequest;
use App\Http\Controllers\Admin\Crews\Requests\UnhideCrewRequest;
use App\Http\Controllers\Controller;
use App\Models\Crew;
use App\Services\Moderation\Statement;
use Closure;
use DomainException;
use Illuminate\Http\RedirectResponse;
use InvalidArgumentException;

/**
 * ADM-80/81 Staff actions on a crew (contract-crews.md C6), all behind a recent password and moderation.decide: hide (a remove_content
 * decision, the founder gets the statement of reasons), unhide (its reversal), remove (only a hidden crew: removed + soft delete) and
 * restore (removed → hidden). The Actions audit (crew.hidden · crew.unhidden · crew.removed · crew.restored, and moderation.decided).
 * A state the action refuses (it changed in between) comes back as the flash error, nothing changes.
 */
class CrewActionsController extends Controller
{
    public function hide(HideCrewRequest $request, Crew $crew, HideCrew $hide): RedirectResponse
    {
        return $this->run(fn () => $hide->handle($request->staff(), $crew, Statement::fromArray($request->validated()), $request->reason()), 'crews.flash.hidden');
    }

    public function unhide(UnhideCrewRequest $request, Crew $crew, UnhideCrew $unhide): RedirectResponse
    {
        return $this->run(fn () => $unhide->handle($request->staff(), $crew, trim($request->string('facts')->value()), $request->reason()), 'crews.flash.unhidden');
    }

    public function remove(CrewReasonRequest $request, Crew $crew, RemoveCrew $remove): RedirectResponse
    {
        return $this->run(fn () => $remove->handle($request->staff(), $crew, $request->reason()), 'crews.flash.removed');
    }

    public function restore(CrewReasonRequest $request, Crew $crew, RestoreCrew $restore): RedirectResponse
    {
        return $this->run(fn () => $restore->handle($request->staff(), $crew, $request->reason()), 'crews.flash.restored');
    }

    /**
     * @param  Closure(): mixed  $action
     */
    private function run(Closure $action, string $flash): RedirectResponse
    {
        try {
            $action();
        } catch (DomainException|InvalidArgumentException) {
            return back(303)->with('error', 'crews.flash.not_possible');
        }

        return back(303)->with('success', $flash);
    }
}
