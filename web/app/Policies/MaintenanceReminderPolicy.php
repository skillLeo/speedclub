<?php

namespace App\Policies;

use App\Models\MaintenanceReminder;
use App\Models\User;

/**
 * M4.13 (09 §8.8): a reminder stage the server handled; only its member reads it (GET me/maintenance/reminders). Nobody writes it but
 * MaintenanceReminders.
 */
class MaintenanceReminderPolicy
{
    public function view(User $user, MaintenanceReminder $reminder): bool
    {
        return $reminder->user_id === $user->id && ! $user->isDeactivated();
    }
}
