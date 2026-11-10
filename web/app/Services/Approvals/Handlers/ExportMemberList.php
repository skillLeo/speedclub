<?php

namespace App\Services\Approvals\Handlers;

use App\Enums\AdminMemberEvent;
use App\Http\Controllers\Admin\Members\MemberListQuery;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Models\User;
use App\Services\Admin\CsvCell;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\ChecksPayloadAtoms;
use App\Services\Approvals\FourEyes;
use App\Services\Audit\Audit;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * members.list_export (SEC-P3-03, 06_ADMIN_SPEC §2 "member/PII export"): the ADM-09 list of a filter with the members' e-mail addresses
 * as CSV. The plain list CSV of ADM-09 stays masked; this one is four-eyes. Requester and approver hold members.export, and both also
 * members.view and members.view_pii (ChecksPayloadAtoms). On approval the file is written to the private disk (formula-safe cells,
 * CsvCell) and the requester downloads it through the signed approval link for speedclub.approvals.download_hours (no-store, each
 * download audited), like audit.export.
 *
 * Payload: filter (the ADM-09 filter keys of MemberListQuery::FILTERS, strings), sort (an ADM-09 sort or null), rows_at_request (what
 * the filter matched when asked, for the approver; the run counts again). More than MAX_ROWS fails: it runs inside one web request.
 */
final class ExportMemberList implements ApprovalHandler, ChecksPayloadAtoms
{
    public const MAX_ROWS = 5000;

    private const SORTS = ['username', 'created_at', 'last_seen_at', 'vehicles_count', 'followers_count'];

    private const COLUMNS = ['id', 'username', 'display_name', 'email', 'status', 'vehicles', 'followers', 'registered_at', 'last_active_at', 'two_factor', 'verified'];

    public function key(): string
    {
        return 'members.list_export';
    }

    public function atom(): string
    {
        return 'members.export';
    }

    public function atomsFor(array $payload): array
    {
        return ['members.view', 'members.view_pii'];
    }

    public function requiresOwner(array $payload): bool
    {
        return false;
    }

    public function validate(array $payload): void
    {
        Validator::make($payload, [
            'filter' => ['present', 'array:'.implode(',', MemberListQuery::FILTERS)],
            'filter.*' => ['nullable', 'string', 'max:200'],
            'sort' => ['nullable', 'string', Rule::in([...self::SORTS, ...array_map(fn (string $sort): string => '-'.$sort, self::SORTS)])],
            'rows_at_request' => ['required', 'integer', 'min:0'],
        ])->validate();
    }

    public function describe(array $payload): array
    {
        $filter = self::filter($payload);

        return [
            'title' => 'approvals.members_list_export.title',
            'subject_label' => null,
            'lines' => [
                ['label' => 'approvals.members_list_export.filter', 'after' => $filter === [] ? null : implode(', ', array_map(fn (string $key, string $value): string => $key.'='.$value, array_keys($filter), $filter))],
                ['label' => 'approvals.members_list_export.rows', 'after' => (string) (int) ($payload['rows_at_request'] ?? 0)],
                ['label' => 'approvals.members_list_export.columns', 'after' => implode(', ', self::COLUMNS)],
            ],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'members.list_export');

        $payload = $request->payload;
        $requester = Staff::query()->findOrFail($request->requested_by);
        $query = self::query($payload, $requester);
        $rows = min((clone $query)->count(), self::MAX_ROWS + 1);

        if ($rows > self::MAX_ROWS) {
            throw ValidationException::withMessages(['filter' => ['The filter matches more than '.self::MAX_ROWS.' members; narrow it.']]);
        }

        $path = config()->string('speedclub.approvals.disk_prefix').'/'.$request->id.'.csv';
        $stream = fopen('php://temp', 'w+b') ?: throw new RuntimeException('Could not open a temporary stream.');
        fwrite($stream, "\u{FEFF}");
        fputcsv($stream, self::COLUMNS, escape: '');

        foreach ($query->limit(self::MAX_ROWS)->lazy(500) as $member) {
            /** @var User $member */
            fputcsv($stream, CsvCell::row([
                $member->id,
                $member->username,
                $member->getAttribute('display_name'),
                $member->email,
                MemberListQuery::status($member),
                (int) $member->getAttribute('vehicles_count'),
                (int) $member->getAttribute('followers_count'),
                self::iso($member->getAttribute('created_at')),
                self::iso($member->getAttribute('last_seen_at')),
                $member->hasTwoFactor(),
                $member->getAttribute('email_verified_at') !== null,
            ]), escape: '');
        }

        rewind($stream);
        $written = Storage::disk(config()->string('speedclub.media.private_disk'))->put($path, $stream);
        fclose($stream);

        if ($written === false) {
            throw new RuntimeException("Could not write $path.");
        }

        Audit::record(AdminMemberEvent::ListExported->value, $request, after: [
            'filter' => self::filter($payload),
            'rows' => $rows,
            'email' => true,
            'requested_by' => $request->requested_by,
            'approved_by' => $approver->getKey(),
        ], reason: $request->reason, actor: $approver);

        return [
            'file' => $path,
            'format' => 'csv',
            'rows' => $rows,
            'download_until' => now()->addHours(config()->integer('speedclub.approvals.download_hours'))->toIso8601String(),
        ];
    }

    /**
     * The members the filter matches, in the page's order, as $staff would see them on ADM-09 (the e-mail text filter included).
     *
     * @param  array<string, mixed>  $payload
     * @return Builder<User>
     */
    public static function query(array $payload, Staff $staff): Builder
    {
        $sort = is_string($payload['sort'] ?? null) ? $payload['sort'] : null;
        $request = Request::create('/admin/members', 'GET', ['filter' => self::filter($payload), ...($sort === null ? [] : ['sort' => $sort])]);

        return MemberListQuery::build($request, $staff)->getEloquentBuilder();
    }

    private static function iso(mixed $value): ?string
    {
        return $value instanceof DateTimeInterface ? $value->format(DateTimeInterface::ATOM) : null;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, string>
     */
    private static function filter(array $payload): array
    {
        $filter = is_array($payload['filter'] ?? null) ? $payload['filter'] : [];

        return array_filter(array_map(fn (mixed $value): ?string => is_string($value) && $value !== '' ? $value : null, $filter), is_string(...));
    }
}
