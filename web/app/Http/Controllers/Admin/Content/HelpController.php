<?php

namespace App\Http\Controllers\Admin\Content;

use App\Actions\Admin\Content\DeleteHelpArticle;
use App\Actions\Admin\Content\SaveHelpArticle;
use App\Actions\Admin\Content\SetHelpArticlePublished;
use App\Http\Controllers\Admin\Content\Requests\HelpArticleRequest;
use App\Http\Controllers\Admin\Content\Requests\HelpDeleteRequest;
use App\Http\Controllers\Admin\Content\Requests\HelpPublishRequest;
use App\Http\Controllers\Controller;
use App\Models\HelpArticle;
use Illuminate\Http\RedirectResponse;
use Inertia\Inertia;
use Inertia\Response;

/**
 * ADM-32 Hilfe (06 §3; SET-14 / WEB-10): the help articles per language with category, order and published state. Create and edit with
 * content.edit (a published article only with content.publish too), publish, unpublish and delete ⚿ with content.publish.
 */
class HelpController extends Controller
{
    public function index(): Response
    {
        $articles = HelpArticle::query()->orderBy('category')->orderBy('sort')->orderBy('key')->orderBy('locale')->get();

        return Inertia::render('Content/Help', [
            'articles' => array_values($articles->map(fn (HelpArticle $article): array => [
                'id' => $article->id,
                'key' => $article->key,
                'locale' => $article->locale,
                'category' => $article->category,
                'title' => $article->title,
                'body_md' => $article->body_md,
                'sort' => $article->sort,
                'published' => $article->published,
                'updated_at' => $article->updated_at?->toIso8601String(),
            ])->all()),
            'categories' => array_values($articles->pluck('category')->filter()->unique()->sort()->values()->all()),
        ]);
    }

    public function store(HelpArticleRequest $request, SaveHelpArticle $save): RedirectResponse
    {
        $save->handle($request->staff(), null, $request->article());

        return back(303)->with('success', 'content.flash.help_saved');
    }

    public function update(HelpArticleRequest $request, SaveHelpArticle $save): RedirectResponse
    {
        $save->handle($request->staff(), $this->article($request->route('article')), $request->article());

        return back(303)->with('success', 'content.flash.help_saved');
    }

    public function published(HelpPublishRequest $request, SetHelpArticlePublished $set): RedirectResponse
    {
        $published = $request->boolean('published');
        $set->handle($request->staff(), $this->article($request->route('article')), $published, $request->reason() === '' ? null : $request->reason());

        return back(303)->with('success', $published ? 'content.flash.help_published' : 'content.flash.help_unpublished');
    }

    public function destroy(HelpDeleteRequest $request, DeleteHelpArticle $delete): RedirectResponse
    {
        $delete->handle($request->staff(), $this->article($request->route('article')), $request->reason());

        return back(303)->with('success', 'content.flash.help_deleted');
    }

    private function article(mixed $id): HelpArticle
    {
        $article = is_numeric($id) ? HelpArticle::query()->find((int) $id) : null;
        abort_if($article === null, 404);

        return $article;
    }
}
