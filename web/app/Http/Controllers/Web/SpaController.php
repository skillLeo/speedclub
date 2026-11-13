<?php

namespace App\Http\Controllers\Web;

use App\Http\Controllers\Controller;
use App\Models\Vehicle;
use App\Services\Garage\PublicMembers;
use App\Services\PublicPages\PublicPageData;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Throwable;

/**
 * Hosts the Expo member web export (ADR-004). Real files under public/app bypass PHP through .htaccess.
 *
 * A shared /app/v/{slug} or /app/u/{username} link previews like the public page: the index gets the page's title, description and
 * link-preview tags in its head (what a guest may see, nothing more), canonical to /v or /u. The app itself shares the public
 * addresses; this keeps older links and copied browser addresses previewing too.
 */
class SpaController extends Controller
{
    private const HEADERS = [
        'Content-Type' => 'text/html; charset=UTF-8',
        'Cache-Control' => 'no-cache, no-store, must-revalidate',
    ];

    public function __invoke(Request $request, PublicPageData $pages, PublicMembers $members, ?string $path = null): BinaryFileResponse|Response
    {
        $index = config()->string('speedclub.spa.index');

        if (! is_file($index)) {
            return response()->view('public.app-not-exported', status: 404);
        }

        $head = $path === null ? null : $this->shareHead($request, $path, $pages, $members);

        if ($head === null) {
            return response()->file($index, self::HEADERS);
        }

        $html = (string) file_get_contents($index);
        $html = preg_match('~<title>.*?</title>~s', $html) === 1
            ? (string) preg_replace('~<title>.*?</title>~s', str_replace(['\\', '$'], ['\\\\', '\\$'], $head), $html, 1)
            : (string) preg_replace('~<head[^>]*>~i', '$0'.str_replace(['\\', '$'], ['\\\\', '\\$'], $head), $html, 1);

        return new Response($html, 200, self::HEADERS);
    }

    /**
     * The head of the public page behind an app address, or null for every other address and for anything a guest may not see.
     */
    private function shareHead(Request $request, string $path, PublicPageData $pages, PublicMembers $members): ?string
    {
        try {
            if (preg_match('~\Av/([A-Za-z0-9-]{1,200})/?\z~', $path, $match) === 1) {
                $vehicle = Vehicle::findBySlug($match[1]);

                $seo = $vehicle !== null && Gate::forUser(null)->allows('view', $vehicle) ? $pages->vehicle($vehicle, $request)['seo'] : null;
            } elseif (preg_match('~\Au/([A-Za-z0-9._-]{1,64})/?\z~', $path, $match) === 1) {
                $member = $members->visibleTo(null, $match[1]);

                $seo = $member === null ? null : $pages->member($member, $request)['seo'];
            } else {
                return null;
            }

            return $seo === null ? null : view('public.partials.app-share-head', ['seo' => $seo, 'locale' => app()->getLocale()])->render();
        } catch (Throwable $exception) {
            // The app still loads; only the preview is plain.
            report($exception);

            return null;
        }
    }
}
