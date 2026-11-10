<?php

namespace App\Http\Controllers\Admin\Media;

use App\Actions\Admin\Media\ApproveMedia;
use App\Actions\Admin\Media\HideMedia;
use App\Actions\Admin\Media\UnhideMedia;
use App\Http\Controllers\Admin\Media\Requests\ApproveMediaRequest;
use App\Http\Controllers\Admin\Media\Requests\HideMediaRequest;
use App\Http\Controllers\Admin\Media\Requests\UnhideMediaRequest;
use App\Http\Controllers\Controller;
use App\Models\Media;
use App\Services\Moderation\Statement;
use Closure;
use DomainException;
use Illuminate\Http\RedirectResponse;
use InvalidArgumentException;

/**
 * ADM-13 actions: Freigeben (`media.review`, keyboard A, no reason needed), Ausblenden (`media.hide`, recent password, statement of
 * reasons: a DSA decision), Einblenden (`media.hide`, recent password, a reverse decision). A chat photo is never reachable (404).
 */
class MediaActionsController extends Controller
{
    public function approve(ApproveMediaRequest $request, Media $media, ApproveMedia $approve): RedirectResponse
    {
        self::ensureReviewable($media);
        $reason = $request->input('reason');

        return $this->run(fn () => $approve->handle($request->staff(), $media, is_string($reason) && trim($reason) !== '' ? trim($reason) : null), 'media.flash.approved');
    }

    public function hide(HideMediaRequest $request, Media $media, HideMedia $hide): RedirectResponse
    {
        self::ensureReviewable($media);

        return $this->run(fn () => $hide->handle($request->staff(), $media, Statement::fromArray($request->validated()), $request->reason()), 'media.flash.hidden');
    }

    public function unhide(UnhideMediaRequest $request, Media $media, UnhideMedia $unhide): RedirectResponse
    {
        self::ensureReviewable($media);

        return $this->run(fn () => $unhide->handle($request->staff(), $media, trim($request->string('facts')->value()), $request->reason()), 'media.flash.unhidden');
    }

    private static function ensureReviewable(Media $media): void
    {
        abort_if(in_array($media->getAttribute('mediable_type'), MediaReviewController::PRIVATE_TYPES, true), 404);
    }

    /**
     * @param  Closure(): mixed  $action
     */
    private function run(Closure $action, string $flash): RedirectResponse
    {
        try {
            $action();
        } catch (DomainException|InvalidArgumentException) {
            return back(303)->with('error', 'media.flash.not_possible');
        }

        return back(303)->with('success', $flash);
    }
}
