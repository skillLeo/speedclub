<?php

use App\Actions\Admin\Members\RequestMemberListExport;
use App\Enums\ApprovalEvent;
use App\Enums\ApprovalStatus;
use App\Models\AuditEvent;
use App\Models\Staff;
use App\Models\User;
use App\Services\Approvals\Approvals;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/Helpers.php';

/**
 * SEC-P3-03: the ADM-09 list with e-mail addresses is the four-eyes `members.list_export` (06 §2 "member/PII export"): asked and approved
 * by staff who both hold members.export and members.view_pii, written to the private disk with formula-safe cells, downloaded by the
 * requester alone through the signed link (no-store, audited).
 */
beforeEach(function () {
    Storage::fake(config()->string('speedclub.media.private_disk'));
    User::factory()->create(['username' => 'lena.gti', 'email' => 'lena@gmail.de', 'display_name' => '=HYPERLINK("https://evil.example")']);
    User::factory()->create(['username' => 'tobi.quattro', 'email' => 'tobi@web.de']);
});

it('asks with the filter and the count, writes the CSV with addresses on approval and lets the requester download it', function () {
    $admin = m31Staff('admin');
    $request = app(RequestMemberListExport::class)->handle($admin, ['q' => 'lena'], '-created_at', 'Anfrage der Datenschutzbehörde, Az. 12/26.');

    expect($request->status)->toBe(ApprovalStatus::Pending)
        ->and($request->summary['title'])->toBe('approvals.members_list_export.title')
        ->and(collect($request->summary['lines'])->firstWhere('label', 'approvals.members_list_export.rows')['after'])->toBe('1')
        ->and(Storage::disk(config()->string('speedclub.media.private_disk'))->allFiles())->toBe([]);

    $done = app(Approvals::class)->approve($request, m31Staff('owner'));
    $csv = (string) Storage::disk(config()->string('speedclub.media.private_disk'))->get((string) $done->result['file']);

    expect($done->status)->toBe(ApprovalStatus::Executed)
        ->and($done->result['rows'])->toBe(1)
        ->and($csv)->toContain('lena@gmail.de')
        ->toContain('"\'=HYPERLINK(""https://evil.example"")"')
        ->not->toContain('tobi@web.de')
        ->and(AuditEvent::query()->where('action', 'member.list_exported')->sole()->after['approved_by'])->toBeInt();

    $response = $this->actingAs($admin, 'staff')->get((string) app(Approvals::class)->downloadUrl($done))->assertOk();
    expect((string) $response->headers->get('Cache-Control'))->toContain('no-store')
        ->and((string) $response->headers->get('Content-Disposition'))->toContain('speedclub-mitglieder-')
        ->and(AuditEvent::query()->where('action', ApprovalEvent::ExportDownloaded->value)->count())->toBe(1);

    $this->actingAs(m31Staff('owner'), 'staff')->get((string) app(Approvals::class)->downloadUrl($done))->assertNotFound();
});

it('refuses a requester without members.export or members.view_pii', function (string $role) {
    expect(fn () => app(RequestMemberListExport::class)->handle(m31Staff($role), [], null, 'Anfrage der Datenschutzbehörde, Az. 12/26.'))
        ->toThrow(AuthorizationException::class);
})->with(['moderator', 'support', 'content_editor', 'analyst']);

it('refuses an approver without members.view_pii, and a download once the requester lost it', function () {
    $admin = m31Staff('admin');
    $request = app(RequestMemberListExport::class)->handle($admin, [], null, 'Anfrage der Datenschutzbehörde, Az. 12/26.');
    $approver = m31Staff();
    $approver->givePermissionTo(['approvals.decide', 'members.export', 'members.view']);

    expect(fn () => app(Approvals::class)->approve($request, $approver->fresh() ?? $approver))->toThrow(AuthorizationException::class);

    $done = app(Approvals::class)->approve($request, m31Staff('owner'));
    $url = (string) app(Approvals::class)->downloadUrl($done);
    $admin->syncRoles([]);
    $admin->givePermissionTo(['members.export', 'members.view']);

    $this->actingAs(Staff::query()->findOrFail($admin->id), 'staff')->get($url)->assertNotFound();
});

it('refuses an unknown filter or sort', function () {
    expect(fn () => app(RequestMemberListExport::class)->handle(m31Staff('admin'), ['password' => 'x'], null, 'Anfrage der Datenschutzbehörde, Az. 12/26.'))->toThrow(ValidationException::class)
        ->and(fn () => app(RequestMemberListExport::class)->handle(m31Staff('admin'), [], 'email', 'Anfrage der Datenschutzbehörde, Az. 12/26.'))->toThrow(ValidationException::class);
});
