<?php

namespace App\Actions\Admin\Media;

use App\Actions\Moderation\ReverseDecision;
use App\Enums\ReportTargetType;
use App\Models\Decision;
use App\Models\Media;
use App\Models\Staff;
use App\Services\Admin\Members\StaffAtoms;
use App\Services\Moderation\ModerationHolds;
use DomainException;
use Illuminate\Auth\Access\AuthorizationException;

/**
 * ADM-13 tab "Ausgeblendet" (`media.hide`, recent password): a `reverse` decision on the removal of the photo. It is usable again and
 * its variants are drawn again from the private original (ADR-123, ContentRestoration); the owner is told why.
 *
 * @throws AuthorizationException|DomainException when no decision removed it
 */
class UnhideMedia
{
    public function __construct(
        private readonly ReverseDecision $reverse,
        private readonly ModerationHolds $holds,
    ) {}

    public function handle(Staff $staff, Media $photo, string $facts, string $reason): Decision
    {
        StaffAtoms::ensure($staff, 'media.hide');

        $removal = $this->holds->activeRemoval(ReportTargetType::Photo, $photo->id)
            ?? throw new DomainException('No decision removed this photo.');

        return $this->reverse->handle($removal, $staff, $facts, trim($reason));
    }
}
