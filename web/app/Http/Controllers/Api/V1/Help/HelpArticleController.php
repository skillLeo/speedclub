<?php

namespace App\Http\Controllers\Api\V1\Help;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\HelpArticleResource;
use App\Http\Resources\V1\HelpArticleSummaryResource;
use App\Models\HelpArticle;
use App\Services\Help\HelpArticles;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;

class HelpArticleController extends Controller
{
    /**
     * Help articles (SET-14).
     *
     * Published articles in the language of Accept-Language, German where there is no translation, in their order. A short list, not
     * paged.
     *
     * @unauthenticated
     */
    public function index(HelpArticles $articles): AnonymousResourceCollection
    {
        Gate::authorize('viewAny', HelpArticle::class);

        return HelpArticleSummaryResource::collection($articles->all(app()->getLocale()));
    }

    /**
     * A help article (SET-14).
     *
     * The body is Markdown. Unknown or unpublished key: 404.
     *
     * @unauthenticated
     */
    public function show(string $key, HelpArticles $articles): HelpArticleResource
    {
        $article = $articles->find($key, app()->getLocale());

        if ($article === null) {
            throw new ApiException(ErrorCode::NotFound);
        }

        Gate::authorize('view', $article);

        return new HelpArticleResource($article);
    }
}
