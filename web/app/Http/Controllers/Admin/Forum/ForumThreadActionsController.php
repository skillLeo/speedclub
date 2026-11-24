<?php

namespace App\Http\Controllers\Admin\Forum;

use App\Actions\Admin\Forum\ForumThreadTools;
use App\Exceptions\ApiException;
use App\Http\Controllers\Admin\Forum\Requests\ForumThreadToolRequest;
use App\Http\Controllers\Controller;
use App\Models\ForumCategory;
use App\Models\ForumPost;
use App\Models\ForumThread;
use Closure;
use Illuminate\Http\RedirectResponse;

/**
 * ADM Forum-Moderation staff tools on a thread (10 §7.3): pin, unpin, lock, unlock, move, merge, solution. Thin: each calls
 * ForumThreadTools, which audits.
 */
class ForumThreadActionsController extends Controller
{
    public function pin(ForumThreadToolRequest $request, string $thread, ForumThreadTools $tools): RedirectResponse
    {
        return $this->run(fn () => $tools->pin($request->staff(), self::find($thread), true, $request->optionalReason()), 'pinned');
    }

    public function unpin(ForumThreadToolRequest $request, string $thread, ForumThreadTools $tools): RedirectResponse
    {
        return $this->run(fn () => $tools->pin($request->staff(), self::find($thread), false, $request->optionalReason()), 'unpinned');
    }

    public function lock(ForumThreadToolRequest $request, string $thread, ForumThreadTools $tools): RedirectResponse
    {
        return $this->run(fn () => $tools->lock($request->staff(), self::find($thread), true, $request->optionalReason()), 'locked');
    }

    public function unlock(ForumThreadToolRequest $request, string $thread, ForumThreadTools $tools): RedirectResponse
    {
        return $this->run(fn () => $tools->lock($request->staff(), self::find($thread), false, $request->optionalReason()), 'unlocked');
    }

    public function move(ForumThreadToolRequest $request, string $thread, ForumThreadTools $tools): RedirectResponse
    {
        $category = ForumCategory::query()->findOrFail($request->integer('category_id'));

        return $this->run(fn () => $tools->move($request->staff(), self::find($thread), $category, $request->reason()), 'moved');
    }

    public function merge(ForumThreadToolRequest $request, string $thread, ForumThreadTools $tools): RedirectResponse
    {
        $target = self::find($request->string('into_thread_id')->value());

        return $this->run(fn () => $tools->merge($request->staff(), self::find($thread), $target, $request->reason()), 'merged');
    }

    public function solution(ForumThreadToolRequest $request, string $thread, ForumThreadTools $tools): RedirectResponse
    {
        $model = self::find($thread);
        $post = $request->filled('post_id') ? ForumPost::query()->where('thread_id', $model->id)->find($request->string('post_id')->lower()->value()) : null;
        abort_if($request->filled('post_id') && $post === null, 404);

        return $this->run(fn () => $tools->setSolution($request->staff(), $model, $post, $request->reason()), 'solution');
    }

    public static function find(string $id): ForumThread
    {
        $thread = preg_match('/^[0-9A-Za-z]{26}$/', $id) === 1 ? ForumThread::query()->find(strtolower($id)) : null;

        abort_unless($thread instanceof ForumThread, 404);

        return $thread;
    }

    /**
     * @param  Closure(): ForumThread  $action
     */
    private function run(Closure $action, string $outcome): RedirectResponse
    {
        try {
            $action();
        } catch (ApiException $refused) {
            return back(303)->withErrors($refused->errors === [] ? ['state' => 'forum.flash.not_possible'] : array_map(fn (array $messages): string => (string) ($messages[0] ?? ''), $refused->errors))
                ->with('error', 'forum.flash.not_possible');
        }

        return back(303)->with('success', "forum.flash.$outcome");
    }
}
