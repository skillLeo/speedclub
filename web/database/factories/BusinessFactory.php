<?php

namespace Database\Factories;

use App\Enums\BusinessKind;
use App\Enums\BusinessLegalForm;
use App\Enums\BusinessRole;
use App\Enums\BusinessStatus;
use App\Models\Business;
use App\Models\BusinessMember;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * A verified test workshop in Hamburg with placeholder Impressum data ("Testbetrieb", never a real company). The owner joins
 * business_members as owner (afterCreating). States for the other statuses.
 *
 * @extends Factory<Business>
 */
class BusinessFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $name = 'Testbetrieb '.Str::title(fake()->unique()->lexify('????????'));

        return [
            'owner_id' => User::factory(),
            'slug' => Str::slug($name),
            'name' => $name,
            'kind' => BusinessKind::Workshop,
            'legal_name' => $name.' GmbH',
            'legal_form' => BusinessLegalForm::Gmbh,
            'representative' => 'Geschäftsführung Testbetrieb',
            'street' => 'Teststraße 1',
            'postcode' => '20095',
            'city' => 'Hamburg',
            'country' => 'DE',
            'lat' => 53.5511,
            'lng' => 9.9937,
            'phone' => null,
            'email' => 'kontakt@example.test',
            'website' => null,
            'register_court' => 'Amtsgericht Hamburg',
            'register_number' => 'HRB 00000',
            'vat_id' => null,
            'about' => null,
            'services' => ['Fahrwerk', 'Abgasanlage'],
            'opening_hours' => ['mon' => [['09:00', '18:00']], 'tue' => [['09:00', '18:00']]],
            'status' => BusinessStatus::Verified,
            'submitted_at' => now()->subDays(10),
            'verified_at' => now()->subDays(9),
            'is_sample' => false,
        ];
    }

    public function configure(): static
    {
        return $this->afterCreating(function (Business $business): void {
            BusinessMember::query()->firstOrCreate(['business_id' => $business->id, 'user_id' => $business->owner_id], ['role' => BusinessRole::Owner]);
        });
    }

    public function applied(): static
    {
        return $this->state(['status' => BusinessStatus::Applied, 'verified_at' => null, 'submitted_at' => now()->subHour()]);
    }

    public function rejected(): static
    {
        return $this->state(['status' => BusinessStatus::Rejected, 'verified_at' => null, 'review_reason' => 'Die Adresse ließ sich nicht prüfen.']);
    }

    public function suspended(): static
    {
        return $this->state(['status' => BusinessStatus::Suspended, 'suspended_at' => now()->subDay()]);
    }
}
