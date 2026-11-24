<?php

namespace App\Http\Controllers\Api\V1\Forum;

use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\Forum\ForumCategoryResource;
use App\Services\Forum\ForumCategories;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * M5.8 forum categories (FOR-01 chips, FOR-02 header, FOR-04 picker). Admin-managed (ADM Forum › Kategorien).
 */
class ForumCategoryController extends Controller
{
    /**
     * List the forum categories.
     *
     * Guests too. The active top-level categories in their order, each with its active sub-categories ("Marken & Modelle" holds one per
     * make, "Treffen & Regionen" one per Bundesland). Names in the reader's language.
     *
     * @unauthenticated
     */
    public function index(ForumCategories $categories): AnonymousResourceCollection
    {
        return ForumCategoryResource::collection($categories->tree());
    }

    /**
     * Show a forum category.
     *
     * Guests too. FOR-02's header: the category with its sub-categories; its threads come from `forum/threads?category={slug}`.
     *
     * @unauthenticated
     */
    public function show(string $slug, ForumCategories $categories): ForumCategoryResource
    {
        $category = $categories->open($slug);

        if ($category === null) {
            throw new ApiException(ErrorCode::NotFound);
        }

        return new ForumCategoryResource($category);
    }
}
