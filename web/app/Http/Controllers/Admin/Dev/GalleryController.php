<?php

namespace App\Http\Controllers\Admin\Dev;

use App\Http\Controllers\Controller;
use Inertia\Inertia;
use Inertia\Response;

/** Every admin component in every state, for design QA (local and testing only, routes/admin/dev.php). */
class GalleryController extends Controller
{
    public function __invoke(): Response
    {
        abort_unless(app()->environment(['local', 'testing']), 404);

        return Inertia::render('Dev/Gallery');
    }
}
