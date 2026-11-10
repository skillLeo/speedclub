<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use Illuminate\Http\Response;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Hosts the Expo member web export (ADR-004). Real files under public/app bypass PHP through .htaccess.
 */
class SpaController extends Controller
{
    public function __invoke(): BinaryFileResponse|Response
    {
        $index = config()->string('speedclub.spa.index');

        if (! is_file($index)) {
            return response()->view('public.app-not-exported', status: 404);
        }

        return response()->file($index, [
            'Content-Type' => 'text/html; charset=UTF-8',
            'Cache-Control' => 'no-cache, no-store, must-revalidate',
        ]);
    }
}
