<?php

use App\Actions\Admin\Config\SaveConfigDraft;
use App\Enums\ConfigKey;
use App\Models\ConfigVersion;
use App\Models\Staff;
use App\Services\Config\ConfigVersions;

require_once __DIR__.'/../M32/Helpers.php';
require_once __DIR__.'/../Config/ConfigHelpers.php';

/**
 * M3.5 brand, content and configuration admin HTTP tests (lane b). Functions are prefixed adm35 so they never collide with the lane-a
 * helpers (m35…). By the 06 §2 role table: brand.manage and content.* are held by Owner, Admin and Content editor; legal.publish,
 * flags.manage, remote_config.manage, maintenance.toggle and releases.manage by Owner and Admin only.
 */
const ADM35_CONTENT = ['owner', 'admin', 'content_editor'];
const ADM35_OWNER_ADMIN = ['owner', 'admin'];

/** The staff member's saved draft of a key (through the Action, as the page saves it). */
function adm35Draft(Staff $staff, ConfigKey $key, array $payload): ConfigVersion
{
    return app(SaveConfigDraft::class)->handle($staff, $key, $payload, null);
}

/** A published version of a key (draft + publish through the engine). */
function adm35Publish(Staff $staff, ConfigKey $key, array $payload, string $reason = 'Erste Fassung für die Saison 2026.'): ConfigVersion
{
    $draft = adm35Draft($staff, $key, $payload);

    return app(ConfigVersions::class)->publish($staff, $key, $reason, $draft->revision);
}

/** Staff of a role, signed in, with a password confirmed more than 5 minutes ago (ADR-215: the next ⚿ write asks again). */
function adm35StalePassword(string $role): Staff
{
    seedStaffRoles();
    $staff = staffWithRole($role);
    actingAsStaff($staff);
    test()->withSession(['auth.password_confirmed_at' => time() - 3600]);

    return $staff;
}
