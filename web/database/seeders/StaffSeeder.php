<?php

namespace Database\Seeders;

use App\Enums\StaffStatus;
use App\Enums\TeamEvent;
use App\Models\Permission;
use App\Models\Role;
use App\Models\Staff;
use App\Services\Audit\Audit;
use Carbon\CarbonImmutable;
use Database\Seeders\Concerns\SeedsFromData;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Spatie\Permission\PermissionRegistrar;

/**
 * Roles and permission atoms of 06_ADMIN_SPEC §2 on guard staff, and the Owner account.
 *
 * Local and staging: the Owner signs in with DEMO_STAFF_PASSWORD and there is one demo account per other role.
 * Elsewhere the Owner gets a random password nobody ever sees and sets a real one through the password reset.
 * No account is seeded with TOTP. EnsureStaffTwoFactor holds each one at enrolment (ADM-03) after its first sign-in: until
 * TOTP is confirmed it reaches only sign-out, the enrolment steps and the password confirmation they need.
 *
 * Outside local and testing every new account is seeded with password_proof_required (SEC-P1-20): it cannot sign in until its owner
 * sets a password through the e-mailed reset link, so whoever knows DEMO_STAFF_PASSWORD cannot enrol their own authenticator on it
 * first. ADMIN_IP_ALLOWLIST (RestrictAdminAccess) can keep /admin off the open internet as well. Existing accounts keep their password
 * and their roles.
 *
 * Running it again on a live host never undoes ADM-41/42 edits (seedRolesAndAtoms()).
 */
class StaffSeeder extends Seeder
{
    use SeedsFromData;

    public const GUARD = 'staff';

    /** Owner and Admin hold every atom; what separates them (managing Owners, org identity) is enforced in the policies. */
    public const ATOMS = [
        'members.view', 'members.view_pii', 'members.edit', 'members.restrict', 'members.suspend', 'members.delete',
        'members.reset_password', 'members.revoke_sessions', 'members.reset_2fa', 'members.view_as', 'members.export',
        'members.message_metadata', 'vehicles.view', 'vehicles.edit', 'vehicles.hide', 'vehicles.delete', 'media.review',
        'media.hide', 'catalog.view', 'catalog.manage', 'catalog.import', 'qr.view', 'qr.revoke', 'moderation.view',
        'moderation.decide', 'moderation.appeals', 'moderation.messages', 'moderation.rules', 'moderation.templates',
        'support.view', 'support.reply', 'support.macros', 'content.view', 'content.edit', 'content.publish', 'brand.manage',
        'legal.publish', 'flags.manage', 'remote_config.manage', 'maintenance.toggle', 'releases.manage', 'staff.view',
        'staff.invite', 'staff.manage', 'roles.manage', 'approvals.decide', 'audit.view', 'audit.export', 'privacy.view',
        'privacy.process', 'retention.manage', 'system.view', 'system.jobs', 'integrations.view', 'analytics.view',
        'memberships.manage',
        // M5.4 (m5.4-contract §8): ADM "Sticker-Designs" and the print files by design id; an Owner can give a print partner's role only this.
        'stickers.print',
        // M5.5 (m5.5-contract §5): ADM-66 Shop-Produkte and ADM-67 Shop-Banner; an Owner can give a shop partner's role only this.
        'shop.manage',
        // ADR-232: every admin list CSV needs it besides the list's view atom; the Analyst has no exports (06 §2).
        'lists.export',
    ];

    /**
     * SEC-M46-04: atoms only the Owner holds. Outside ATOMS, so the ADM-42 matrix can neither show nor grant them, and the Admin role
     * does not get them. system.mail_preview opens a recorded mail of ADM-61, which may hold a member's sign-in code.
     */
    public const OWNER_ONLY = ['system.mail_preview'];

    public const ROLES = [
        'moderator' => [
            'moderation.view', 'moderation.decide', 'moderation.appeals', 'moderation.messages', 'moderation.rules',
            'moderation.templates', 'media.review', 'media.hide', 'vehicles.view', 'vehicles.hide', 'members.view',
            'members.restrict', 'members.suspend', 'qr.view', 'support.view', 'lists.export',
        ],
        'support' => [
            'members.view', 'members.view_pii', 'members.reset_password', 'members.revoke_sessions', 'members.view_as',
            'support.view', 'support.reply', 'support.macros', 'privacy.view', 'vehicles.view', 'qr.view', 'lists.export',
        ],
        'content_editor' => [
            'content.view', 'content.edit', 'content.publish', 'brand.manage', 'catalog.view', 'catalog.manage',
            'catalog.import', 'qr.view', 'lists.export', 'shop.manage',
        ],
        'analyst' => ['analytics.view', 'members.view', 'vehicles.view', 'qr.view', 'moderation.view'],
    ];

    public function run(): void
    {
        $registrar = app(PermissionRegistrar::class);
        $registrar->forgetCachedPermissions();

        $this->seedRolesAndAtoms();

        $registrar->forgetCachedPermissions();

        $demoPassword = app()->environment(['local', 'staging']) ? config('speedclub.demo.staff_password') : null;
        $demoPassword = is_string($demoPassword) && $demoPassword !== '' ? $demoPassword : null;

        $this->seedOwner($demoPassword);

        if ($demoPassword !== null) {
            foreach (['admin', ...array_keys(self::ROLES)] as $role) {
                $this->assignOnCreate($this->account(str_replace('_', '-', $role).'@speedclub.test', 'Demo '.Str::headline($role), $demoPassword, demo: true), $role);
            }
        }
    }

    /**
     * Every (role, atom) pair of the spec table: Owner and Admin with every atom, the other roles with theirs.
     *
     * @return array<string, list<string>>
     */
    public static function specTable(): array
    {
        return ['owner' => [...self::ATOMS, ...self::OWNER_ONLY], 'admin' => self::ATOMS, ...self::ROLES];
    }

    /**
     * A fresh install (no staff role yet) gets the full spec table. An existing one keeps what ADM-41/42 made of it: missing atoms and
     * missing seeded roles are added, and a spec pair is granted only once, the first time this seeder sees it (staff_seed_grants), so
     * an atom an Owner took away from a role stays away. When the ledger is still empty on an existing install (the first run after it
     * was introduced), the pairs of atoms that already existed are recorded as handed out without touching the roles; only atoms new in
     * this run reach the roles the spec names.
     */
    private function seedRolesAndAtoms(): void
    {
        $fresh = ! Role::query()->where('guard_name', self::GUARD)->exists();
        $known = Permission::query()->where('guard_name', self::GUARD)->pluck('name')->all();
        $baseline = ! $fresh && ! DB::table('staff_seed_grants')->exists();

        foreach ([...self::ATOMS, ...self::OWNER_ONLY] as $atom) {
            Permission::findOrCreate($atom, self::GUARD);
        }

        $ledger = DB::table('staff_seed_grants')->get(['role', 'permission'])
            ->map(fn (object $row): string => $row->role.'|'.$row->permission)->flip();
        $now = now();
        $rows = [];

        foreach (self::specTable() as $name => $atoms) {
            $existing = Role::query()->where('guard_name', self::GUARD)->where('name', $name)->first();
            $role = $existing ?? Role::findOrCreate($name, self::GUARD);

            $grant = match (true) {
                $fresh, $existing === null => $atoms,
                $baseline => array_values(array_diff($atoms, $known)),
                default => array_values(array_filter($atoms, fn (string $atom): bool => ! $ledger->has($name.'|'.$atom))),
            };

            if ($fresh || $existing === null) {
                $role->syncPermissions($atoms);
            } elseif ($grant !== []) {
                $role->givePermissionTo($grant);
            }

            foreach ($atoms as $atom) {
                if (! $ledger->has($name.'|'.$atom)) {
                    $rows[] = ['role' => $name, 'permission' => $atom, 'created_at' => $now];
                }
            }
        }

        foreach (array_chunk($rows, 200) as $chunk) {
            DB::table('staff_seed_grants')->insertOrIgnore($chunk);
        }
    }

    private function seedOwner(?string $password): void
    {
        $emails = self::ownerEmails();

        if ($emails === []) {
            $this->warn('STAFF_OWNER_EMAIL is not set: no Owner account created.');

            return;
        }

        foreach ($emails as $email) {
            $owner = $this->account($email, 'Owner', $password ?? Str::password(40), demo: $password !== null);

            // The Owner maximum (ADM-40) holds for seeded Owners too: a further address is left for the team page.
            if ($owner->wasRecentlyCreated && Staff::query()->role('owner', self::GUARD)->count() >= config()->integer('speedclub.team.max_owners')) {
                $this->warn("{$email}: the Owner maximum is reached, the account has no role yet.");

                continue;
            }

            $this->assignOnCreate($owner, 'owner');
            $this->ownerWhenNone($owner);
        }

        if ($password === null) {
            $this->say('Owner account(s) ready. Each sets its password through the one-time link (web installer) or the staff password reset.');
        }
    }

    /**
     * The Owner addresses of STAFF_OWNER_EMAIL: one, or several separated by commas (client round 6: the platform owner first, then a
     * second Owner), lower-cased, valid addresses only, without repeats.
     *
     * @return list<string>
     */
    public static function ownerEmails(): array
    {
        $configured = config('speedclub.staff.owner_email');
        $emails = [];

        foreach (explode(',', is_string($configured) ? $configured : '') as $email) {
            $email = Str::lower(trim($email));
            if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) !== false && ! in_array($email, $emails, true)) {
                $emails[] = $email;
            }
        }

        return $emails;
    }

    /**
     * Client round 6: the account of STAFF_OWNER_EMAIL is the platform owner's. When it existed already with another role (invited as an
     * Admin before the address was set) and no Owner exists at all, nobody could save the company data or manage the team (ADR-239);
     * it then becomes the Owner, audited. With any Owner in place, roles stay as ADM-40 left them.
     */
    private function ownerWhenNone(Staff $staff): void
    {
        if ($staff->wasRecentlyCreated || $staff->hasRole('owner') || Staff::query()->role('owner', self::GUARD)->exists()) {
            return;
        }

        $before = $staff->getRoleNames()->values()->all();
        $staff->syncRoles(['owner']);
        Audit::record(TeamEvent::RolesChanged->value, $staff, before: ['roles' => $before], after: ['roles' => ['owner'], 'via' => 'staff_seeder_owner_email']);
        $this->say("{$staff->email} had no Owner beside it: it is the Owner now (STAFF_OWNER_EMAIL).");
    }

    /** A seeded account gets its role when it is created; later role changes (ADM-40) are left alone. */
    private function assignOnCreate(Staff $staff, string $role): void
    {
        if ($staff->wasRecentlyCreated) {
            $staff->syncRoles([$role]);
        }
    }

    private function account(string $email, string $name, string $password, bool $demo = false): Staff
    {
        $staff = Staff::query()->firstOrCreate(['email' => $email], [
            'name' => $name,
            'password' => $password,
            'status' => StaffStatus::Active,
        ]);

        if ($staff->wasRecentlyCreated && ! app()->environment(['local', 'testing'])) {
            $staff->forceFill(['password_proof_required' => true])->save();
        }

        // Demo accounts (DEMO_STAFF_PASSWORD, local and staging only) date from the demo clock, so ADM-40 "Im Team seit" reads the
        // same after every re-seed. A real Owner (no demo password, so never on production) keeps the moment it was created.
        if ($staff->wasRecentlyCreated && $demo) {
            $at = CarbonImmutable::parse(DemoSeeder::NOW);
            $staff->timestamps = false;
            $staff->forceFill(['created_at' => $at, 'updated_at' => $at])->save();
            $staff->timestamps = true;
        }

        return $staff;
    }
}
