<?php

namespace App\Actions\Admin\Content;

use App\Enums\ContentEvent;
use App\Models\HelpArticle;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Audit\Audit;
use App\Services\Catalog\Reason;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ADM-32 publish / unpublish (`content.publish`, optional reason). Audited as `help.published` / `help.unpublished`.
 */
final class SetHelpArticlePublished
{
    /**
     * @throws AuthorizationException|ValidationException
     */
    public function handle(Staff $staff, HelpArticle $article, bool $published, ?string $reason = null): HelpArticle
    {
        StaffAtoms::ensure($staff, 'content.publish');
        $reason = Reason::optional($reason);

        return DB::transaction(function () use ($staff, $article, $published, $reason): HelpArticle {
            $before = SaveHelpArticle::describe($article);
            $article->forceFill(['published' => $published])->save();

            Audit::record(($published ? ContentEvent::HelpPublished : ContentEvent::HelpUnpublished)->value, $article,
                before: $before, after: SaveHelpArticle::describe($article), reason: $reason, actor: $staff);

            return $article;
        });
    }
}
