<?php

use App\Actions\Admin\Businesses\ReviewBusiness;
use App\Actions\Admin\Catalog\ApplyCatalogImport;
use App\Actions\Admin\Catalog\MergeCatalogEntries;
use App\Actions\Admin\Config\UpdateFeatureFlag;
use App\Actions\Admin\Content\PublishLegalDocument;
use App\Actions\Admin\Members\BulkMemberAction;
use App\Actions\Admin\Members\DeleteMemberAsStaff;
use App\Actions\Admin\Members\ExportMemberData;
use App\Actions\Admin\Members\ResetMemberTwoFactor;
use App\Actions\Admin\Moderation\BulkNoAction;
use App\Actions\Admin\Support\BulkTicketStatus;
use App\Actions\Admin\Team\ApplyPermissionMatrix;
use App\Actions\Admin\Team\ChangeStaffRoles;
use App\Actions\Admin\Team\DeactivateStaff;
use App\Actions\Admin\Team\DeleteStaff;
use App\Actions\Admin\Team\ReactivateStaff;
use App\Actions\Admin\Team\ResetStaffTwoFactor;
use App\Actions\Admin\Vehicles\BulkHideVehicles;
use App\Services\Approvals\ApprovalExecution;
use App\Services\Approvals\FourEyes;
use App\Services\Approvals\Handlers\ApplyCatalogImportInBulk;
use App\Services\Approvals\Handlers\BulkMembers;
use App\Services\Approvals\Handlers\ChangeCriticalFlag;
use App\Services\Approvals\Handlers\CloseCasesInBulk;
use App\Services\Approvals\Handlers\DeactivatePrivilegedStaff;
use App\Services\Approvals\Handlers\DeleteMember;
use App\Services\Approvals\Handlers\DeleteOwnerStaff;
use App\Services\Approvals\Handlers\EnableMaintenance;
use App\Services\Approvals\Handlers\ExportMember;
use App\Services\Approvals\Handlers\GrantSensitiveAtoms;
use App\Services\Approvals\Handlers\HideVehiclesInBulk;
use App\Services\Approvals\Handlers\MergeCatalogEntriesInBulk;
use App\Services\Approvals\Handlers\PublishLegalWithReconsent;
use App\Services\Approvals\Handlers\ReactivateOwnerStaff;
use App\Services\Approvals\Handlers\ResetStaffTwoFactorHandler;
use App\Services\Approvals\Handlers\SetTicketStatusInBulk;
use App\Services\Approvals\Handlers\StaffRoleElevation;
use App\Services\Approvals\Handlers\SuspendBusiness;
use App\Services\Config\ConfigVersions;
use Tests\Support\SourceScanner;

/**
 * MF-1 of the M3.1 review (SEC-P3-10): the four-eyes executors are reached only from the approval handlers (and the member bulk
 * action, whose own execute() is reached only from its handler); FourEyes::executor() refuses them at run time anywhere else, which
 * tests/Feature/Admin/Actions/FourEyesTest proves per executor.
 */
arch('four-eyes executors are only used by the approval handlers and the member bulk action')
    ->expect([ResetMemberTwoFactor::class, DeleteMemberAsStaff::class, ExportMemberData::class])
    ->toOnlyBeUsedIn(['App\Services\Approvals\Handlers', BulkMemberAction::class]);

arch('the approval handlers are only used by the engine and the actions that ask for them')
    ->expect('App\Services\Approvals\Handlers')
    ->toOnlyBeUsedIn(['App\Services\Approvals', 'App\Actions\Admin\Members\RequestMemberListExport']);

arch('the four-eyes check is only used by the engine, its handlers, the executors, DecideCase and the operator command')
    ->expect(FourEyes::class)
    ->toOnlyBeUsedIn([
        'App\Services\Approvals',
        'App\Actions\Admin\Members',
        'App\Actions\Admin\Vehicles\BulkHideVehicles',
        // M3.4 bulk executors (moderation.bulk_no_action, support.bulk_status).
        'App\Actions\Admin\Moderation\BulkNoAction',
        'App\Actions\Admin\Support\BulkTicketStatus',
        'App\Actions\Admin\Catalog\MergeCatalogEntries',
        'App\Actions\Admin\Catalog\ApplyCatalogImport',
        'App\Actions\Admin\Config\UpdateFeatureFlag',
        'App\Actions\Admin\Content\PublishLegalDocument',
        // M3.6: the Team executors (role elevation, privileged deactivation, Owner deletion, sensitive atoms).
        'App\Actions\Admin\Team\ChangeStaffRoles',
        'App\Actions\Admin\Team\DeactivateStaff',
        'App\Actions\Admin\Team\DeleteStaff',
        'App\Actions\Admin\Team\ApplyPermissionMatrix',
        // ADR-238: the lost-authenticator reset (staff.reset_two_factor).
        'App\Actions\Admin\Team\ResetStaffTwoFactor',
        // SF-6 of the M3.4-batch review: reactivating an Owner (staff.reactivate_owner).
        'App\Actions\Admin\Team\ReactivateStaff',
        'App\Services\Config\ConfigVersions',
        'App\Actions\Moderation\DecideCase',
        // M4.14: suspending a business (business.suspend).
        'App\Actions\Admin\Businesses\ReviewBusiness',
        'App\Console\Commands\DecideModerationCaseCommand',
    ]);

arch('only the engine creates the executing request')
    ->expect(ApprovalExecution::class)
    ->toOnlyBeUsedIn('App\Services\Approvals');

/*
 * SF-1 of the M3.4-batch review: the executor methods added since M3.2 sit on Actions that also have a direct path, so the class rules
 * above cannot express them. FOUR_EYES_EXECUTORS names each executor method and the handler(s) allowed to call it; the scan below
 * fails when (a) a FourEyes::executor() check sits in a method this list does not name, or (b) production code other than the named
 * callers calls an executor method. Tests are not scanned: tests/Feature/Admin/Actions/FourEyesTest proves the run-time refusal.
 */
const FOUR_EYES_EXECUTORS = [
    ExportMemberData::class => ['handle' => [ExportMember::class, BulkMemberAction::class]],
    ResetMemberTwoFactor::class => ['handle' => [App\Services\Approvals\Handlers\ResetMemberTwoFactor::class]],
    DeleteMemberAsStaff::class => ['handle' => [DeleteMember::class, BulkMemberAction::class]],
    BulkMemberAction::class => ['execute' => [BulkMembers::class]],
    BulkHideVehicles::class => ['execute' => [HideVehiclesInBulk::class]],
    BulkNoAction::class => ['execute' => [CloseCasesInBulk::class]],
    BulkTicketStatus::class => ['execute' => [SetTicketStatusInBulk::class]],
    MergeCatalogEntries::class => ['execute' => [MergeCatalogEntriesInBulk::class]],
    // M4.14: business.suspend.
    ReviewBusiness::class => ['suspend' => [SuspendBusiness::class]],
    ApplyCatalogImport::class => ['execute' => [ApplyCatalogImportInBulk::class]],
    UpdateFeatureFlag::class => ['execute' => [ChangeCriticalFlag::class]],
    PublishLegalDocument::class => ['execute' => [PublishLegalWithReconsent::class]],
    ChangeStaffRoles::class => ['applyApproved' => [StaffRoleElevation::class]],
    ApplyPermissionMatrix::class => ['applyApproved' => [GrantSensitiveAtoms::class]],
    DeactivateStaff::class => ['deactivateApproved' => [DeactivatePrivilegedStaff::class]],
    DeleteStaff::class => ['deleteApproved' => [DeleteOwnerStaff::class]],
    ResetStaffTwoFactor::class => ['resetApproved' => [ResetStaffTwoFactorHandler::class]],
    ReactivateStaff::class => ['reactivateApproved' => [ReactivateOwnerStaff::class]],
    // ConfigVersions checks FourEyes in its private approved(), reached only through these two.
    ConfigVersions::class => [
        'publishApproved' => [EnableMaintenance::class],
        'rollbackApproved' => [EnableMaintenance::class],
    ],
];

/** Private methods holding the FourEyes::executor() check for the public executors of their class listed above. */
const FOUR_EYES_PRIVATE_CHECKS = [ConfigVersions::class => ['approved']];

/** Method names so common that a call only counts when the file also names the executor's class. */
const FOUR_EYES_GENERIC_METHODS = ['execute', 'handle'];

function fourEyesWebRoot(): string
{
    return dirname(__DIR__, 2);
}

/** @return list<string> production PHP files (no tests, no vendor) */
function fourEyesProductionFiles(): array
{
    $root = fourEyesWebRoot();

    return SourceScanner::phpFiles(["$root/app", "$root/routes", "$root/database", "$root/config", "$root/bootstrap"]);
}

/** The class a file under app/ declares, by PSR-4. */
function fourEyesClassOf(string $file): ?string
{
    $app = fourEyesWebRoot().'/app/';

    return str_starts_with($file, $app) ? 'App\\'.str_replace('/', '\\', substr($file, strlen($app), -4)) : null;
}

/**
 * Whether $code names $class outside comments: its full name, an import of it, or its short name inside its own namespace.
 */
function fourEyesNames(string $code, string $class): bool
{
    $namespace = substr($class, 0, (int) strrpos($class, '\\'));
    $short = substr($class, (int) strrpos($class, '\\') + 1);
    $inNamespace = false;
    $shortSeen = false;

    foreach (PhpToken::tokenize($code) as $index => $token) {
        if ($token->is([T_COMMENT, T_DOC_COMMENT, T_WHITESPACE])) {
            continue;
        }

        if ($token->is([T_NAME_QUALIFIED, T_NAME_FULLY_QUALIFIED]) && ltrim($token->text, '\\') === $class) {
            return true;
        }

        if ($token->is(T_NAME_QUALIFIED) && ltrim($token->text, '\\') === $namespace) {
            $inNamespace = true;
        }

        if ($token->is(T_STRING) && $token->text === $short) {
            $shortSeen = true;
        }
    }

    return $inNamespace && $shortSeen;
}

/**
 * Calls of executor methods in $code (a production file at $file) that are not allowed there: "Class::method:line".
 *
 * @return list<string>
 */
function fourEyesViolations(string $code, string $file): array
{
    $caller = fourEyesClassOf($file);
    $violations = [];

    foreach (FOUR_EYES_EXECUTORS as $class => $methods) {
        foreach ($methods as $method => $allowed) {
            if ($caller !== null && in_array($caller, $allowed, true)) {
                continue;
            }

            $generic = in_array($method, FOUR_EYES_GENERIC_METHODS, true);

            if ($generic && ($caller === $class || ! fourEyesNames($code, $class))) {
                continue;
            }

            // A name two executors share (applyApproved): the call belongs to the one the file names, if it names only the other.
            $others = array_filter(array_keys(FOUR_EYES_EXECUTORS), fn (string $other): bool => $other !== $class && isset(FOUR_EYES_EXECUTORS[$other][$method]));

            if (! $generic && $others !== [] && ! fourEyesNames($code, $class)
                && array_filter($others, fn (string $other): bool => fourEyesNames($code, $other)) !== []) {
                continue;
            }

            foreach (SourceScanner::methodCalls($code, [strtolower($method)]) as $call) {
                $violations[] = $class.'::'.$method.':'.substr($call, strrpos($call, ':') + 1);
            }
        }
    }

    return $violations;
}

it('lets only the named handlers call an executor method', function () {
    $violations = [];

    foreach (fourEyesProductionFiles() as $file) {
        foreach (fourEyesViolations((string) file_get_contents($file), $file) as $violation) {
            $violations[] = str_replace(fourEyesWebRoot().'/', '', $file).' → '.$violation;
        }
    }

    expect($violations)->toBe([]);
});

it('knows every method that runs FourEyes::executor()', function () {
    $unknown = [];
    $checked = 0;

    foreach (fourEyesProductionFiles() as $file) {
        $code = (string) file_get_contents($file);
        $class = fourEyesClassOf($file);

        if ($class === null || $class === FourEyes::class || ! str_contains($code, 'FourEyes::executor(')) {
            continue;
        }

        $lines = [];
        foreach (explode("\n", $code) as $number => $line) {
            if (str_contains($line, 'FourEyes::executor(')) {
                $lines[] = $number + 1;
            }
        }

        foreach ($lines as $line) {
            $method = collect((new ReflectionClass($class))->getMethods())
                ->first(fn (ReflectionMethod $m): bool => $m->getDeclaringClass()->getName() === $class && $m->getStartLine() <= $line && $m->getEndLine() >= $line);
            $name = $method?->getName();
            $known = $name !== null && (isset(FOUR_EYES_EXECUTORS[$class][$name]) || in_array($name, FOUR_EYES_PRIVATE_CHECKS[$class] ?? [], true));
            $checked++;

            if (! $known) {
                $unknown[] = "$class::".($name ?? '?').":$line";
            }
        }
    }

    expect($unknown)->toBe([])->and($checked)->toBeGreaterThanOrEqual(count(FOUR_EYES_EXECUTORS));
});

it('names only executors and handlers that exist', function () {
    foreach (FOUR_EYES_EXECUTORS as $class => $methods) {
        foreach ($methods as $method => $allowed) {
            expect(method_exists($class, $method))->toBeTrue("$class::$method");

            foreach ($allowed as $caller) {
                expect(class_exists($caller))->toBeTrue($caller);
            }
        }
    }
});

it('detects an executor called from a controller, with or without the class named', function () {
    $direct = <<<'PHP'
    <?php
    namespace App\Http\Controllers\Admin\Team;
    use App\Actions\Admin\Team\ChangeStaffRoles;
    class Sneaky { public function __invoke(ChangeStaffRoles $change, $r, $a, $b) { $change->applyApproved($r, $a, $b); } }
    PHP;
    $generic = <<<'PHP'
    <?php
    namespace App\Http\Controllers\Admin\Moderation;
    use App\Actions\Admin\Moderation\BulkNoAction;
    class Sneaky { public function __invoke(BulkNoAction $bulk) { return $bulk->execute($a, $b, [], 'x'); } }
    PHP;
    $unrelated = <<<'PHP'
    <?php
    namespace App\Http\Controllers\Admin\Moderation;
    // BulkNoAction is only named in this comment.
    class Fine { public function __invoke($job) { return $job->execute(); } }
    PHP;
    $handler = <<<'PHP'
    <?php
    namespace App\Services\Approvals\Handlers;
    use App\Actions\Admin\Moderation\BulkNoAction;
    class CloseCasesInBulk { public function run(BulkNoAction $bulk) { return $bulk->execute($a, $b, [], 'x'); } }
    PHP;
    $app = fourEyesWebRoot().'/app/';

    expect(fourEyesViolations($direct, $app.'Http/Controllers/Admin/Team/Sneaky.php'))->toBe(['App\Actions\Admin\Team\ChangeStaffRoles::applyApproved:4'])
        ->and(fourEyesViolations(str_replace('use App\Actions\Admin\Team\ChangeStaffRoles;', '', $direct), $app.'Http/Controllers/Admin/Team/Sneaky.php'))->toHaveCount(2)
        ->and(fourEyesViolations($generic, $app.'Http/Controllers/Admin/Moderation/Sneaky.php'))->toBe(['App\Actions\Admin\Moderation\BulkNoAction::execute:4'])
        ->and(fourEyesViolations($unrelated, $app.'Http/Controllers/Admin/Moderation/Fine.php'))->toBe([])
        ->and(fourEyesViolations($handler, $app.'Services/Approvals/Handlers/CloseCasesInBulk.php'))->toBe([]);
});
