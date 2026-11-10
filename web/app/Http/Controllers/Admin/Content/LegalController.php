<?php

namespace App\Http\Controllers\Admin\Content;

use App\Actions\Admin\Content\DiscardLegalDraft;
use App\Actions\Admin\Content\PublishLegalDocument;
use App\Actions\Admin\Content\SaveLegalDraft;
use App\Enums\ApprovalStatus;
use App\Enums\LegalDocumentKey;
use App\Http\Controllers\Admin\Config\Support\ConfigAnswers;
use App\Http\Controllers\Admin\Content\Requests\ContentEditRequest;
use App\Http\Controllers\Admin\Content\Requests\LegalDraftRequest;
use App\Http\Controllers\Admin\Content\Requests\LegalPublishRequest;
use App\Http\Controllers\Admin\Content\Requests\MarkdownPreviewRequest;
use App\Http\Controllers\Controller;
use App\Models\ApprovalRequest;
use App\Models\LegalDocument;
use App\Models\Staff;
use App\Services\AppConfig\LegalDocuments;
use App\Services\Privacy\OrgIdentity;
use App\Support\SafeMarkdown;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpFoundation\Response as HttpResponse;

/**
 * ADM-31 Rechtstexte (06 §3, 08_LEGAL_COMPLIANCE, m3.5 §2): every document × language with its versions; the one draft per document and
 * language in a Markdown editor with the preview of SET-17/18 and the Blade pages (SafeMarkdown); "erfordert erneute Zustimmung" for AGB
 * and Datenschutz with the changes summary the app shows. Drafts with `content.edit`, publishing with `legal.publish` ⚿; a re-consent
 * publish is four-eyes (`legal.publish_reconsent`).
 */
class LegalController extends Controller
{
    public function index(Request $request): Response
    {
        /** @var Staff $staff */
        $staff = $request->user('staff');
        /** @var list<string> $locales */
        $locales = config('speedclub.locales');

        $key = LegalDocumentKey::tryFrom((string) $request->query('document')) ?? LegalDocumentKey::Terms;
        $locale = in_array($request->query('locale'), $locales, true) ? (string) $request->query('locale') : $locales[0];

        $rows = LegalDocument::query()->orderByDesc('published_at')->orderByDesc('id')->get();
        $names = Staff::query()->whereIn('id', $rows->pluck('published_by')->merge($rows->pluck('created_by'))->filter()->unique()->values())->pluck('name', 'id');

        $documents = [];
        foreach (LegalDocumentKey::cases() as $documentKey) {
            foreach ($locales as $documentLocale) {
                $mine = $rows->filter(fn (LegalDocument $row): bool => $row->key === $documentKey && $row->locale === $documentLocale);
                $current = $mine->first(fn (LegalDocument $row): bool => $row->published_at !== null && $row->published_at <= now());
                $draft = $mine->first(fn (LegalDocument $row): bool => $row->published_at === null);
                $documents[] = [
                    'key' => $documentKey->value,
                    'locale' => $documentLocale,
                    'version' => $current?->version,
                    'published_at' => $current?->published_at?->toIso8601String(),
                    'draft' => $draft?->version,
                ];
            }
        }

        $selected = $rows->filter(fn (LegalDocument $row): bool => $row->key === $key && $row->locale === $locale)->values();
        $draft = $selected->first(fn (LegalDocument $row): bool => $row->published_at === null);
        $current = $selected->first(fn (LegalDocument $row): bool => $row->published_at !== null && $row->published_at <= now());
        $pending = $draft === null ? null : ApprovalRequest::query()->where('subject_type', $draft->getMorphClass())
            ->where('subject_id', (string) $draft->id)->where('status', ApprovalStatus::Pending)->latest()->first();

        return Inertia::render('Content/Legal', [
            'documents' => $documents,
            'selected' => ['key' => $key->value, 'locale' => $locale, 'reconsentable' => in_array($key, LegalDocuments::RECONSENT, true)],
            'versions' => array_values($selected->filter(fn (LegalDocument $row): bool => $row->published_at !== null)->map(fn (LegalDocument $row): array => [
                'id' => $row->id,
                'version' => $row->version,
                'published_at' => $row->published_at?->toIso8601String(),
                'published_by' => $names[$row->published_by] ?? null,
                'reason' => $row->reason,
                'requires_reconsent' => $row->requires_reconsent,
                'summary' => $row->summary,
                'current' => $current !== null && $row->is($current),
                'scheduled' => $row->published_at !== null && $row->published_at > now(),
            ])->all()),
            'draft' => $draft === null ? null : [
                'id' => $draft->id,
                'version' => $draft->version,
                'body_md' => $draft->body_md,
                'requires_reconsent' => $draft->requires_reconsent,
                'summary' => $draft->summary,
                'revision' => PublishLegalDocument::revision($draft),
                'author' => $names[$draft->created_by] ?? null,
                'updated_at' => $draft->updated_at?->toIso8601String(),
                'approval' => $pending === null ? null : ['id' => $pending->id, 'expires_at' => $pending->expires_at->toIso8601String()],
            ],
            'current' => $current === null ? null : ['version' => $current->version, 'body_md' => $current->body_md],
            'can' => ['edit' => $staff->can('content.edit'), 'publish' => $staff->can('legal.publish')],
        ]);
    }

    public function save(LegalDraftRequest $request, SaveLegalDraft $save): HttpResponse
    {
        $key = LegalDocumentKey::tryFrom((string) $request->route('document'));
        abort_if($key === null, 404);

        return ConfigAnswers::run($request, function () use ($request, $save, $key) {
            $save->handle($request->staff(), $key, (string) $request->route('locale'), $request->draft(), $request->revision());

            return back(303)->with('success', 'content.flash.legal_saved');
        });
    }

    public function discard(ContentEditRequest $request, DiscardLegalDraft $discard): HttpResponse
    {
        $draft = LegalDocument::query()->find((int) $request->route('draft'));
        abort_if($draft === null, 404);

        return ConfigAnswers::run($request, function () use ($request, $discard, $draft) {
            $discard->handle($request->staff(), $draft);

            return back(303)->with('success', 'content.flash.legal_discarded');
        });
    }

    public function publish(LegalPublishRequest $request, PublishLegalDocument $publish): HttpResponse
    {
        $draft = LegalDocument::query()->find((int) $request->route('draft'));
        abort_if($draft === null, 404);

        return ConfigAnswers::run($request, function () use ($request, $publish, $draft) {
            $outcome = $publish->handle($request->staff(), $draft, $request->reason(), $request->revision());

            return ConfigAnswers::outcome($outcome->approval, 'content.flash.legal_published');
        });
    }

    /** The Markdown as members will read it (org placeholders filled), for the editor's preview. */
    public function preview(MarkdownPreviewRequest $request, OrgIdentity $org): JsonResponse
    {
        $markdown = $org->resolve($request->string('body_md')->value());

        return response()->json(['html' => SafeMarkdown::render($markdown)->toHtml()]);
    }
}
