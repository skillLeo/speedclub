<?php

namespace App\Http\Controllers\Internal;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use League\Flysystem\PathTraversalDetected;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * GET /storage/{path} (ADR-539): serves the public disk through PHP on a host where public/storage cannot be a link (symlink()
 * forbidden and no shell, DEPLOY.md §6). Where the link exists the web server answers these URLs itself and this route only sees
 * files that do not exist (404), so it adds nothing a linked host would not serve. It never lists a directory, never serves a
 * dot file, never leaves the public disk's root (Flysystem refuses ../), and never touches the private disk.
 */
class PublicStorageController extends Controller
{
    public function __invoke(Request $request, string $path): BinaryFileResponse
    {
        $disk = Storage::disk('public');

        if (config('filesystems.disks.public.driver') !== 'local' || preg_match('#(^|/)\.#', $path) === 1) {
            abort(404);
        }

        try {
            abort_unless($disk->fileExists($path), 404);
            $file = $disk->path($path);
        } catch (PathTraversalDetected) {
            abort(404);
        }

        $response = new BinaryFileResponse($file, 200, [
            'Cache-Control' => 'public, max-age='.config()->integer('speedclub.media.php_served_max_age'),
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        ], true, null, true, true);
        $response->isNotModified($request);

        return $response;
    }
}
