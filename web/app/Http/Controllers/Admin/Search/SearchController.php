<?php

namespace App\Http\Controllers\Admin\Search;

use App\Http\Controllers\Admin\Support\SearchData;
use App\Http\Controllers\Controller;
use App\Models\Staff;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/** ADM-07 grouped results page. */
class SearchController extends Controller
{
    public function __invoke(Request $request, SearchData $search): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        $q = SearchQuery::from($request);

        return Inertia::render('Search/Index', [
            'q' => $q,
            'groups' => $q === '' ? [] : $search->search($staff, $q),
        ]);
    }
}
