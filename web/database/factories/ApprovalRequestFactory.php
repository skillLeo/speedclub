<?php

namespace Database\Factories;

use App\Enums\ApprovalStatus;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * A pending audit export by default. Tests of the rules go through Approvals::request(); this is for lists and queues.
 *
 * @extends Factory<ApprovalRequest>
 */
class ApprovalRequestFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'action' => 'audit.export',
            'payload' => ['format' => 'csv', 'filter' => []],
            'summary' => ['title' => 'approvals.audit_export.title', 'subject_label' => null, 'lines' => []],
            'reason' => 'Prüfung durch die Rechtsabteilung',
            'requested_by' => Staff::factory(),
            'status' => ApprovalStatus::Pending,
            'pending_key' => fn (): string => hash('sha256', Str::random(40)),
            'expires_at' => now()->addDay(),
        ];
    }

    public function expired(): static
    {
        return $this->state(['expires_at' => now()->subMinute()]);
    }
}
