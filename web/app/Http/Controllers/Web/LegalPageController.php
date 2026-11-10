<?php

namespace App\Http\Controllers\Web;

use App\Enums\LegalDocumentKey;
use App\Http\Controllers\Controller;
use App\Services\AppConfig\LegalDocuments;
use App\Support\SafeMarkdown;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * WEB-08: from the legal CMS. A language without its own text gets the German one, which is the binding version.
 */
class LegalPageController extends Controller
{
    /** A short text needs no table of contents. */
    private const TOC_FROM_SECTIONS = 4;

    public function __invoke(Request $request, string $document, LegalDocuments $documents): Response
    {
        $key = LegalDocumentKey::from($document);
        $current = $documents->current($key, app()->getLocale());

        if ($current === null) {
            return response()->view('public.state', ['state' => 'not_published'], 404);
        }

        $source = SafeMarkdown::splitTitle((string) $current->getAttribute('body_md'));
        $html = SafeMarkdown::render($source['body']);
        $page = SafeMarkdown::withHeadingAnchors($html);
        $hasToc = count($page['toc']) >= self::TOC_FROM_SECTIONS;

        return response()->view('public.legal', [
            'key' => $key->value,
            'title' => $source['title'] ?? $key->label(),
            'html' => $hasToc ? $page['html'] : $html,
            'toc' => $hasToc ? $page['toc'] : [],
            'version' => (string) $current->getAttribute('version'),
            'published_at' => $current->published_at,
            'is_fallback' => $current->getAttribute('locale') !== app()->getLocale(),
            'canonical' => url($request->path()),
        ]);
    }
}
