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
 * ADM-32 delete (`content.publish`, reason): removes one key and locale. Audited as `help.deleted` with what it was.
 */
final class DeleteHelpArticle
{
    /**
     * @throws AuthorizationException|ValidationException
     */
    public function handle(Staff $staff, HelpArticle $article, string $reason): void
    {
        StaffAtoms::ensure($staff, 'content.publish');
        $reason = Reason::required($reason);

        DB::transaction(function () use ($staff, $article, $reason): void {
            $before = SaveHelpArticle::describe($article);
            $article->delete();

            Audit::record(ContentEvent::HelpDeleted->value, $article, before: $before, reason: $reason, actor: $staff);
        });
    }
}
