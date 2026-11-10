<?php

namespace App\Http\Controllers\Admin\Search;

use App\Http\Controllers\Admin\Support\SearchData;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Results for the ⌘K palette as they are typed: the same service as ADM-07, as JSON. */
class SearchSuggestController extends Controller
{
    public function __invoke(Request $request, SearchData $search): JsonResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $q = SearchQuery::from($request);

        return new JsonResponse(['q' => $q, 'groups' => mb_strlen($q) < 2 ? [] : $search->search($staff, $q)], 200, [
            'Cache-Control' => 'no-store, private',
        ]);
    }
}
