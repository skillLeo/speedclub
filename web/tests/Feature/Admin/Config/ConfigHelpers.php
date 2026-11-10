<?php

use App\Enums\BrandAssetKind;
use App\Models\ApprovalRequest;
use App\Models\BrandAsset;
use App\Models\Staff;
use App\Models\User;
use App\Models\Vehicle;
use App\Services\Approvals\Approvals;
use App\Services\Brand\BrandAssets;
use Database\Seeders\StaffSeeder;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Spatie\Permission\Models\Role;

require_once __DIR__.'/../../Staff/Helpers.php';

/**
 * M3.5 brand, content and configuration tests (lane a). Functions are prefixed m35 so they cannot collide with helpers of other suites.
 */
function m35Reason(): string
{
    return 'Neue Saison: Startbild und Hinweise aktualisiert.';
}

function m35Approve(ApprovalRequest $request, ?Staff $approver = null): ApprovalRequest
{
    return app(Approvals::class)->approve($request, $approver ?? m31Staff('owner'));
}

/**
 * A staff member holding exactly $atoms (a role made for the test).
 */
function m35StaffWith(string ...$atoms): Staff
{
    m31Roles();
    $role = Role::findOrCreate('m35-'.implode('-', $atoms), StaffSeeder::GUARD);
    $role->syncPermissions($atoms);

    $staff = Staff::factory()->twoFactorConfirmed()->create();
    $staff->assignRole($role);

    return $staff->fresh() ?? $staff;
}

/**
 * The roles of 06_ADMIN_SPEC §2 and whether they hold every one of $atoms.
 *
 * @return array<string, array{0: string, 1: bool}>
 */
function m35Matrix(string ...$atoms): array
{
    $rows = [];

    foreach (M31_ROLES as $role) {
        $holds = in_array($role, ['owner', 'admin'], true)
            || array_diff($atoms, StaffSeeder::ROLES[$role] ?? []) === [];
        $rows[$role] = [$role, $holds];
    }

    return $rows;
}

/**
 * @return array<string, mixed>
 */
function m35Remote(array $overrides = []): array
{
    return array_replace_recursive([
        'min_version' => ['ios' => '0.1.0', 'android' => '0.1.0'],
        'latest_version' => ['ios' => '0.2.0', 'android' => '0.2.0'],
        'force_update_message' => null,
        'maintenance' => ['enabled' => false, 'message' => null],
    ], $overrides);
}

/**
 * @return array<string, mixed>
 */
function m35Branding(array $overrides = []): array
{
    return array_replace_recursive([
        'logos' => [],
        'heroes' => [],
        'og_default' => null,
        'accent_set' => 'signalRed',
        'default_theme' => 'carbon',
    ], $overrides);
}

function m35FakeDisks(): void
{
    Storage::fake(config()->string('speedclub.brand.public_disk'));
    Storage::fake(config()->string('speedclub.brand.private_disk'));
}

function m35SeedPhoto(string $name): string
{
    $path = base_path('../design/seed-photos/'.$name);

    return is_file($path) ? $path : base_path('../mobile/assets/brand/'.$name);
}

function m35Upload(string $path, string $mime = 'image/jpeg'): UploadedFile
{
    return new UploadedFile($path, basename($path), $mime, null, true);
}

function m35Asset(BrandAssetKind $kind = BrandAssetKind::Hero, string $photo = 'welcome-hero.jpg'): BrandAsset
{
    return app(BrandAssets::class)->store(m35Upload(m35SeedPhoto($photo)), $kind, m31Staff('owner'));
}

function m35Vehicle(?User $owner = null): Vehicle
{
    return Vehicle::factory()->published()->create(['owner_id' => ($owner ?? User::factory()->create())->id]);
}
