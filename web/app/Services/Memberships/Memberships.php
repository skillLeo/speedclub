<?php

namespace App\Services\Memberships;

use App\Models\FeatureFlag;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * The flagged memberships scaffold (ADM-F1/F2, 06 §3): everything is behind `premium.enabled`, off by default. While off, the admin routes
 * answer 404 and the nav hides them; every Memberships Action refuses the same way, whoever calls it. Read straight from the flag row
 * (an admin request, not a member one: FeatureFlags' member rules such as staff_only and percentages do not apply here).
 */
final class Memberships
{
    public const FLAG = 'premium.enabled';

    public function enabled(): bool
    {
        return FeatureFlag::query()->where('key', self::FLAG)->value('enabled') === true;
    }

    /**
     * @throws NotFoundHttpException
     */
    public function ensureEnabled(): void
    {
        if (! $this->enabled()) {
            throw new NotFoundHttpException;
        }
    }
}
