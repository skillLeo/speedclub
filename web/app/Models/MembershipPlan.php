<?php

namespace App\Models;

use Database\Factories\MembershipPlanFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A plan of the flagged memberships scaffold (ADM-F1, premium.enabled off by default). No price, no payment data: future digital premium
 * goes through Apple IAP / Google Play Billing (06 §3 Memberships). Only the Memberships Actions write it.
 *
 * @property int $id
 * @property string $key
 * @property array{de: string, en: string|null} $name
 * @property array{de: list<string>, en: list<string>} $features
 * @property bool $active
 * @property int $sort
 */
class MembershipPlan extends Model
{
    /** @use HasFactory<MembershipPlanFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'name' => 'array',
            'features' => 'array',
            'active' => 'boolean',
            'sort' => 'integer',
        ];
    }

    /**
     * @return HasMany<Entitlement, $this>
     */
    public function entitlements(): HasMany
    {
        return $this->hasMany(Entitlement::class, 'plan_id');
    }
}
