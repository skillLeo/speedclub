<?php

namespace App\Http\Controllers\Admin\Content;

use App\Actions\Admin\Content\ResetMessageTemplate;
use App\Actions\Admin\Content\SaveMessageTemplate;
use App\Actions\Admin\Content\SendTemplateTest;
use App\Http\Controllers\Admin\Config\Support\ConfigAnswers;
use App\Http\Controllers\Admin\Content\Requests\TemplateFieldsRequest;
use App\Http\Controllers\Controller;
use App\Models\MessageTemplate;
use App\Services\Content\MessageTemplates;
use App\Services\Content\TemplateRegistry;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpFoundation\Response as HttpResponse;

/**
 * ADM-33 E-Mail- und Push-Vorlagen (06 §3, m3.5 §2): every text the platform sends, per language, with its variables and the preview
 * with sample data. Sign-in, code, security and decision texts are fixed (code, legal or DSA text) and shown read-only; editable ones
 * keep single fixed fields (the DSA redress lines). "Test an mich senden" goes to the acting staff member's own address only.
 */
class TemplatesController extends Controller
{
    public function index(Request $request, TemplateRegistry $registry, MessageTemplates $templates): Response
    {
        /** @var list<string> $locales */
        $locales = config('speedclub.locales');
        $saved = MessageTemplate::query()->get()->groupBy('key');
        // Without a choice the first template opens, so the editor is never an empty pane.
        $key = is_string($request->query('template')) && $registry->get($request->query('template')) !== null ? $request->query('template') : array_key_first($registry->all());
        $locale = in_array($request->query('locale'), $locales, true) ? (string) $request->query('locale') : $locales[0];

        $list = [];
        foreach ($registry->all() as $templateKey => $definition) {
            $rows = $saved->get($templateKey);
            $list[] = [
                'key' => $templateKey,
                'channel' => $definition['channel']->value,
                'editable' => $definition['editable'],
                'customised' => $rows === null ? [] : array_values($rows->pluck('locale')->all()),
                'updated_at' => $rows?->max('updated_at')?->toIso8601String(),
            ];
        }

        $selected = null;
        if ($key !== null) {
            $defaults = $registry->defaults($key, $locale);
            $mine = $templates->saved($key, $locale);
            $fields = [];
            foreach ($defaults as $field => $text) {
                $fields[] = [
                    'name' => $field,
                    'default' => $text,
                    'saved' => $mine[$field] ?? null,
                    'editable' => $registry->editable($key, $field),
                    'variables' => TemplateRegistry::variables($text),
                    'plural' => str_contains($text, '|'),
                ];
            }
            $selected = ['key' => $key, 'locale' => $locale, 'fields' => $fields, 'rendered' => $templates->render($key, $locale)];
        }

        return Inertia::render('Content/Templates', [
            'templates' => $list,
            'selected' => $selected,
            'samples' => TemplateRegistry::SAMPLES,
        ]);
    }

    public function save(TemplateFieldsRequest $request, SaveMessageTemplate $save): HttpResponse
    {
        return ConfigAnswers::run($request, function () use ($request, $save) {
            $save->handle($request->staff(), $request->template(), $request->locale(), $request->fields() ?? []);

            return back(303)->with('success', 'content.flash.template_saved');
        });
    }

    public function reset(TemplateFieldsRequest $request, ResetMessageTemplate $reset): HttpResponse
    {
        abort_if(app(TemplateRegistry::class)->get($request->template()) === null, 404);
        $reset->handle($request->staff(), $request->template(), $request->locale());

        return back(303)->with('success', 'content.flash.template_reset');
    }

    /** The template with the sample values and the unsaved fields (JSON for the editor's preview); nothing is stored. */
    public function preview(TemplateFieldsRequest $request, SaveMessageTemplate $save, MessageTemplates $templates): HttpResponse
    {
        return ConfigAnswers::run($request, function () use ($request, $save, $templates): JsonResponse {
            $fields = $request->fields();
            $draft = $fields === null ? null : array_filter($save->validated($request->template(), $request->locale(), $fields), is_string(...));

            return response()->json(['rendered' => $templates->render($request->template(), $request->locale(), $draft)]);
        });
    }

    public function test(TemplateFieldsRequest $request, SendTemplateTest $send): HttpResponse
    {
        return ConfigAnswers::run($request, function () use ($request, $send) {
            $send->handle($request->staff(), $request->template(), $request->locale(), $request->fields());

            return back(303)->with('success', 'content.flash.template_test_sent');
        });
    }
}
