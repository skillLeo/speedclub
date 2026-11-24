<?php

namespace App\Http\Controllers\Admin\Forum;

use App\Actions\Admin\Forum\HideForumPost;
use App\Actions\Admin\Forum\ReviewForumPost;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Admin\Forum\Requests\ForumDecisionRequest;
use App\Http\Controllers\Admin\Forum\Requests\ForumHideRequest;
use App\Http\Controllers\Controller;
use App\Models\ForumPost;
use App\Services\Moderation\Statement;
use DomainException;
use Illuminate\Http\RedirectResponse;

/**
 * ADM Forum-Moderation writes on a post: pre-moderation approve/reject (with the `version` the staff member saw) and "Ausblenden" (a DSA
 * remove_content decision with a statement of reasons). Thin: each calls its Action, which audits. A changed post goes back with the
 * error `version` = `forum.conflict.changed`; a state that no longer allows it with `state` = `forum.flash.not_possible`.
 */
class ForumPostActionsController extends Controller
{
    public function approve(ForumDecisionRequest $request, string $post, ReviewForumPost $review): RedirectResponse
    {
        return $this->decided(fn () => $review->approve($request->staff(), self::find($post), $request->optionalReason(), $request->version()), 'approved');
    }

    public function reject(ForumDecisionRequest $request, string $post, ReviewForumPost $review): RedirectResponse
    {
        return $this->decided(fn () => $review->reject($request->staff(), self::find($post), $request->reason(), $request->version()), 'rejected');
    }

    public function hide(ForumHideRequest $request, string $post, HideForumPost $hide): RedirectResponse
    {
        try {
            $hide->handle($request->staff(), self::find($post), Statement::fromArray($request->validated()), $request->reason());
        } catch (DomainException) {
            return back(303)->with('error', 'forum.flash.not_possible');
        }

        return back(303)->with('success', 'forum.flash.hidden');
    }

    public static function find(string $id): ForumPost
    {
        $post = preg_match('/^[0-9A-Za-z]{26}$/', $id) === 1 ? ForumPost::query()->with('thread')->find(strtolower($id)) : null;

        abort_unless($post instanceof ForumPost, 404);

        return $post;
    }

    /**
     * @param  \Closure(): ForumPost  $action
     */
    private function decided(\Closure $action, string $outcome): RedirectResponse
    {
        try {
            $post = $action();
        } catch (ApiException $refused) {
            $changed = $refused->errorCode === ErrorCode::EditConflict;
            $back = back(303)->withErrors([$changed ? 'version' : 'state' => $changed ? 'forum.conflict.changed' : 'forum.flash.not_possible']);

            return $changed ? $back : $back->with('error', 'forum.flash.not_possible');
        }

        return back(303)->with('success', "forum.flash.$outcome")->with(ForumQueueController::DECIDED, [
            'id' => $post->id,
            'thread_id' => $post->thread_id,
            'outcome' => $outcome,
            'version' => ReviewForumPost::version($post),
        ]);
    }
}
