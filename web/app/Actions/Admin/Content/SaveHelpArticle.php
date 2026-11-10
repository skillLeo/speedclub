<?php

namespace App\Actions\Admin\Content;

use App\Enums\ContentEvent;
use App\Models\HelpArticle;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * ADM-32 (`content.edit`): create or edit a help article (SET-14 / WEB-10). A new article starts unpublished; editing one that is
 * published changes what members read at once, so it also needs `content.publish`. One row per key and locale (the DE row is the
 * fallback). Audited as `help.saved` (before/after without the body, its hash instead).
 */
final class SaveHelpArticle
{
    /**
     * @param  array<string, mixed>  $input  key, locale, category?, title, body_md, sort?
     *
     * @throws AuthorizationException|ValidationException
     */
    public function handle(Staff $staff, ?HelpArticle $article, array $input): HelpArticle
    {
        StaffAtoms::ensure($staff, 'content.edit');

        if ($article?->published === true) {
            StaffAtoms::ensure($staff, 'content.publish');
        }

        $data = Validator::make($input, [
            'key' => ['required', 'string', 'regex:/\A[a-z0-9][a-z0-9-]{0,63}\z/',
                Rule::unique('help_articles', 'key')->where('locale', $input['locale'] ?? null)->ignore($article?->id)],
            'locale' => ['required', Rule::in(config()->array('speedclub.locales'))],
            'category' => ['nullable', 'string', 'regex:/\A[a-z][a-z0-9_]{0,31}\z/'],
            'title' => ['required', 'string', 'max:160'],
            'body_md' => ['required', 'string', 'max:20000'],
            'sort' => ['nullable', 'integer', 'between:0,65535'],
        ])->validate();

        return DB::transaction(function () use ($staff, $article, $data): HelpArticle {
            $before = $article === null ? null : self::describe($article);
            $article ??= new HelpArticle(['published' => false]);
            $article->fill([
                'key' => $data['key'],
                'locale' => $data['locale'],
                'category' => $data['category'] ?? null,
                'title' => trim((string) $data['title']),
                'body_md' => (string) $data['body_md'],
                'sort' => (int) ($data['sort'] ?? $article->sort ?? 0),
            ])->save();

            Audit::record(ContentEvent::HelpSaved->value, $article, before: $before, after: self::describe($article), actor: $staff);

            return $article;
        });
    }

    /**
     * @return array<string, mixed>
     */
    public static function describe(HelpArticle $article): array
    {
        return [
            'key' => $article->key,
            'locale' => $article->locale,
            'category' => $article->category,
            'title' => $article->title,
            'sort' => $article->sort,
            'published' => $article->published,
            'body_sha256' => hash('sha256', $article->body_md),
        ];
    }
}
