<?php

use App\Enums\GroundDocument;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Approvals\Approvals;
use App\Services\Moderation\Statement;

require_once __DIR__.'/../../Staff/Helpers.php';
require_once __DIR__.'/../../Moderation/ModerationTestHelpers.php';

/**
 * M3.2 Action tests (lane a). Functions are prefixed m32 so they cannot collide with helpers of other suites.
 */
function m32Statement(): Statement
{
    return new Statement('Wiederholt beleidigende Nachrichten an andere Mitglieder.', 'Community-Richtlinien §2 (Respekt)', GroundDocument::Community, '2');
}

function m32Reason(): string
{
    return 'Ticket 4711: mehrere Beschwerden geprüft.';
}

function m32Approve(ApprovalRequest $request, ?Staff $approver = null): ApprovalRequest
{
    return app(Approvals::class)->approve($request, $approver ?? m31Staff('owner'));
}

/**
 * The role table of 06_ADMIN_SPEC §2, written out (SF-9): the atoms each role besides Owner and Admin (everything) holds. Not read from
 * StaffSeeder, so a seeder that grants a role more (or less) than the spec fails the matrices and the seeder test below.
 * ADR-232 adds `lists.export` (every admin list CSV) to Moderator, Support and Content editor; never to the Analyst ("No exports").
 */
const M32_SPEC_ROLES = [
    'moderator' => [
        'moderation.view', 'moderation.decide', 'moderation.appeals', 'moderation.messages', 'moderation.rules', 'moderation.templates',
        'media.review', 'media.hide', 'vehicles.view', 'vehicles.hide', 'members.view', 'members.restrict', 'members.suspend', 'qr.view',
        'support.view', 'lists.export', // ADR-232
    ],
    'support' => [
        'members.view', 'members.view_pii', 'members.reset_password', 'members.revoke_sessions', 'members.view_as', 'support.view',
        'support.reply', 'support.macros', 'privacy.view', 'vehicles.view', 'qr.view', 'lists.export', // ADR-232
    ],
    'content_editor' => ['content.view', 'content.edit', 'content.publish', 'brand.manage', 'catalog.view', 'catalog.manage', 'catalog.import', 'qr.view', 'lists.export'], // ADR-232
    'analyst' => ['analytics.view', 'members.view', 'vehicles.view', 'qr.view', 'moderation.view'],
];

/** The six roles with whether each may run an action holding $atom, by the 06 §2 table (M32_SPEC_ROLES). */
function m32Matrix(string $atom): array
{
    $rows = [];

    foreach (M31_ROLES as $role) {
        $rows[$role] = [$role, in_array($role, ['owner', 'admin'], true) || in_array($atom, M32_SPEC_ROLES[$role] ?? [], true)];
    }

    return $rows;
}
