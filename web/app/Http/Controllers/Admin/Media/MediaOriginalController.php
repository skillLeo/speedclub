<?php

namespace App\Http\Controllers\Admin\Media;

use App\Http\Controllers\Controller;
use App\Models\Media;
use App\Models\Staff;
use App\Services\Admin\Media\MediaOriginals;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * ADM-13 "Ausgeblendet" (DQ-532): a moderator who may reverse a removal must see what they reverse. "Anzeigen" (a POST, audited) answers
 * a signed URL valid five minutes; only that URL serves the private original, never cached. The page shows the blurhash until then.
 */
class MediaOriginalController extends Controller
{
    public function reveal(Request $request, Media $media, MediaOriginals $originals): JsonResponse
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');

        return response()->json($originals->reveal($staff, $media));
    }

    public function file(Media $media, MediaOriginals $originals): Response
    {
        return response($originals->bytes($media), 200, [
            'Content-Type' => 'image/jpeg',
            'Content-Disposition' => 'inline',
            'Cache-Control' => 'private, no-store, max-age=0',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
