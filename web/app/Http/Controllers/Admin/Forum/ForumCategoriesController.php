<?php

namespace App\Http\Controllers\Admin\Forum;

use App\Actions\Admin\Forum\ManageForumCategories;
use App\Enums\ForumCategoryKind;
use App\Exceptions\ApiException;
use App\Http\Controllers\Admin\Forum\Requests\ForumCategoryOrderRequest;
use App\Http\Controllers\Admin\Forum\Requests\ForumCategoryRequest;
use App\Http\Controllers\Admin\Forum\Requests\ForumCategorySyncRequest;
use App\Http\Controllers\Controller;
use App\Models\ForumCategory;
use App\Models\Staff;
use Closure;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM Forum › Kategorien (10 §7.1, m5.8-contract §6): the tree with admin-only thread counts; create, edit, reorder, delete an empty
 * category, "Marken abgleichen". Writes need moderation.rules (route and FormRequest) and a recent password.
 */
class ForumCategoriesController extends Controller
{
    public function index(Request $request): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return Inertia::render('Forum/Categories', [
            'categories' => ForumAdminRecord::categoryTree(),
            'kinds' => array_map(fn (ForumCategoryKind $kind): string => $kind->value, ForumCategoryKind::cases()),
            'canManage' => $staff->can('moderation.rules'),
        ]);
    }

    public function store(ForumCategoryRequest $request, ManageForumCategories $manage): RedirectResponse
    {
        return $this->run(fn () => $manage->add($request->staff(), $request->safe()->except('reason'), $request->optionalReason()), 'category_created');
    }

    public function update(ForumCategoryRequest $request, ForumCategory $category, ManageForumCategories $manage): RedirectResponse
    {
        return $this->run(fn () => $manage->change($request->staff(), $category, $request->safe()->except('reason'), $request->optionalReason()), 'category_updated');
    }

    public function destroy(ForumCategoryRequest $request, ForumCategory $category, ManageForumCategories $manage): RedirectResponse
    {
        return $this->run(fn () => $manage->remove($request->staff(), $category, $request->optionalReason()), 'category_deleted');
    }

    public function order(ForumCategoryOrderRequest $request, ManageForumCategories $manage): RedirectResponse
    {
        return $this->run(fn () => $manage->reorder($request->staff(), $request->ids(), trim($request->string('reason')->value()) ?: null), 'categories_reordered');
    }

    public function sync(ForumCategorySyncRequest $request, ManageForumCategories $manage): RedirectResponse
    {
        return $this->run(fn () => $manage->syncMakes($request->staff(), trim($request->string('reason')->value()) ?: null), 'categories_synced');
    }

    /**
     * @param  Closure(): mixed  $action
     */
    private function run(Closure $action, string $outcome): RedirectResponse
    {
        try {
            $action();
        } catch (ApiException $refused) {
            return back(303)->withErrors($refused->errors === [] ? ['state' => $refused->getMessage()] : array_map(fn (array $messages): string => (string) ($messages[0] ?? ''), $refused->errors))
                ->with('error', 'forum.flash.not_possible');
        }

        return back(303)->with('success', "forum.flash.$outcome");
    }
}
