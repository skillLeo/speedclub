<?php

namespace App\Http\Requests\Api\V1\Forum;

use App\Services\Search\SearchTerms;

/**
 * Forum search (FOR-01 search field, DISC-02 "Forum"): `q` 2–100 characters; category and sort as the thread list.
 */
class ForumSearchRequest extends ForumThreadListRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [...parent::rules(), 'q' => ['required', 'string', 'min:2', 'max:'.config()->integer('speedclub.search.query_max_length')]];
    }

    /**
     * @return list<string>
     */
    public function words(): array
    {
        return SearchTerms::queryWords($this->string('q')->value());
    }
}
