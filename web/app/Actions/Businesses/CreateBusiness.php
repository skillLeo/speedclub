<?php

namespace App\Actions\Businesses;

use App\Enums\BusinessRole;
use App\Enums\BusinessStatus;
use App\Enums\ErrorCode;
use App\Exceptions\ApiException;
use App\Models\Business;
use App\Models\BusinessMember;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * BIZ-02 Bewerbung (09 §8.10): the member's business starts as `applied`, waiting for staff (ADM-55); the applicant is its owner.
 * One business per member, as owner or staff (409 business_exists).
 */
class CreateBusiness
{
    /**
     * @param  array<string, mixed>  $data  validated StoreBusinessRequest data
     */
    public function handle(User $user, array $data): Business
    {
        return DB::transaction(function () use ($user, $data): Business {
            User::query()->whereKey($user->id)->lockForUpdate()->value('id');

            if (BusinessMember::query()->where('user_id', $user->id)->exists() || Business::query()->where('owner_id', $user->id)->exists()) {
                throw new ApiException(ErrorCode::BusinessExists);
            }

            $business = new Business;
            BusinessFields::fill($business, $data);
            $business->forceFill([
                'owner_id' => $user->id,
                'slug' => BusinessFields::slug((string) $data['name'], (string) $data['city']),
                'country' => $data['country'] ?? 'DE',
                'status' => BusinessStatus::Applied,
                'submitted_at' => now(),
            ])->save();

            BusinessMember::query()->create(['business_id' => $business->id, 'user_id' => $user->id, 'role' => BusinessRole::Owner]);

            return $business->refresh();
        });
    }
}
