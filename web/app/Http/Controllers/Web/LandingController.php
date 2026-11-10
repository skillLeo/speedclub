<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Services\PublicPages\LandingPage;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * WEB-03: the brand layer, with one real build in it.
 */
class LandingController extends Controller
{
    public function __invoke(Request $request, LandingPage $landing): Response
    {
        return response()->view('public.home', $landing->data($request));
    }
}
