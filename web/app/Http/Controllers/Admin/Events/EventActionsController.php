<?php

namespace App\Http\Controllers\Admin\Events;

use App\Actions\Admin\Events\ReviewEvent;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Admin\Events\Requests\ApproveEventRequest;
use App\Http\Controllers\Admin\Events\Requests\DecideEventRequest;
use App\Http\Controllers\Controller;
use App\Models\Event;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

/**
 * ADM-53/54 writes: approve, reject (reason for the organiser), cancel a published event (reason for the attendees) and reopen a
 * decision (the SplitQueue's undo). Thin: each calls its Action, which audits. Every write carries the `version` it was decided on
 * (optimistic locking, ADR-439).
 *
 * Answers: an Inertia visit goes back with the success flash and `events.decided` (the undo of ADM-53); a changed event comes back with
 * the error `version` = `events.conflict.changed` (the page shows "changed meanwhile" and reloads), a state that no longer allows the
 * action with `state` = `events.flash.not_possible`. A JSON client gets 200 {status, version} or 409 {code, message}.
 */
class EventActionsController extends Controller
{
    public function approve(ApproveEventRequest $request, string $event, ReviewEvent $review): RedirectResponse|JsonResponse
    {
        return $this->run($request, 'approved', fn () => $review->approve($request->staff(), EventShowController::find($event), $request->optionalReason(), $request->version()));
    }

    public function reject(DecideEventRequest $request, string $event, ReviewEvent $review): RedirectResponse|JsonResponse
    {
        return $this->run($request, 'rejected', fn () => $review->reject($request->staff(), EventShowController::find($event), $request->reason(), $request->version()));
    }

    public function cancel(DecideEventRequest $request, string $event, ReviewEvent $review): RedirectResponse|JsonResponse
    {
        return $this->run($request, 'cancelled', fn () => $review->cancel($request->staff(), EventShowController::find($event), $request->reason(), $request->version()));
    }

    public function reopen(ApproveEventRequest $request, string $event, ReviewEvent $review): RedirectResponse|JsonResponse
    {
        return $this->run($request, 'reopened', fn () => $review->reopen($request->staff(), EventShowController::find($event), $request->optionalReason(), $request->version()));
    }

    /**
     * @param  Closure(): Event  $action
     */
    private function run(Request $request, string $outcome, Closure $action): RedirectResponse|JsonResponse
    {
        $json = $request->expectsJson() && ! $request->hasHeader('X-Inertia');

        try {
            $event = $action();
        } catch (ApiException $refused) {
            $changed = $refused->errorCode === ErrorCode::EditConflict;
            $key = $changed ? 'events.conflict.changed' : 'events.flash.not_possible';

            if ($json) {
                return response()->json(['code' => $changed ? 'changed_meanwhile' : 'not_possible', 'message' => $key], 409);
            }

            $back = back(303)->withErrors([$changed ? 'version' : 'state' => $key]);

            return $changed ? $back : $back->with('error', $key);
        }

        $version = ReviewEvent::version($event);

        if ($json) {
            return response()->json(['status' => $event->status->value, 'version' => $version]);
        }

        return back(303)->with('success', "events.flash.$outcome")->with(EventQueueController::DECIDED, [
            'id' => $event->id,
            'title' => $event->title,
            'outcome' => $outcome,
            'status' => $event->status->value,
            'version' => $version,
        ]);
    }
}
