<?php

namespace App\Services\Approvals\Handlers;

use App\Enums\AuditActorType;
use App\Models\ApprovalRequest;
use App\Models\Staff;
use App\Services\Admin\CsvCell;
use App\Services\Approvals\ApprovalHandler;
use App\Services\Approvals\FourEyes;
use App\Services\Audit\Audit;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * audit.export (06_ADMIN_SPEC §2 four-eyes list, ADM-44): the audit events of a filter as CSV or JSONL, written to the private disk on
 * approval and downloadable by the requester for speedclub.approvals.download_hours through a signed admin link (each download is
 * audited). Without IPs or user agents, which live outside the chain (ADR-113).
 *
 * Payload: format (csv|jsonl) and filter {actor_type?, actor_id?, action? (prefix), target_type?, target_id?, from?, to? (Y-m-d,
 * German days)}. Larger than speedclub.approvals.audit_export_max_rows fails: the request runs inside one web request on a shared host.
 * CSV cells are formula-safe (CsvCell, SF-5); JSONL keeps the raw values. A file left behind by an approval that did not commit is
 * swept by approvals:expire (review N-9).
 */
final class ExportAuditLog implements ApprovalHandler
{
    private const COLUMNS = ['id', 'occurred_at', 'actor_type', 'actor_id', 'action', 'target_type', 'target_id', 'before', 'after', 'reason', 'request_id', 'prev_hash', 'hash'];

    public function key(): string
    {
        return 'audit.export';
    }

    public function atom(): string
    {
        return 'audit.export';
    }

    public function requiresOwner(array $payload): bool
    {
        return false;
    }

    public function validate(array $payload): void
    {
        Validator::make($payload, [
            'format' => ['required', Rule::in(['csv', 'jsonl'])],
            'filter' => ['present', 'array:actor_type,actor_id,action,target_type,target_id,from,to'],
            'filter.actor_type' => ['nullable', Rule::enum(AuditActorType::class)],
            'filter.actor_id' => ['nullable', 'string', 'max:26'],
            'filter.action' => ['nullable', 'string', 'max:100'],
            'filter.target_type' => ['nullable', 'string', 'max:40'],
            'filter.target_id' => ['nullable', 'string', 'max:26'],
            'filter.from' => ['nullable', 'date_format:Y-m-d'],
            'filter.to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:filter.from'],
        ])->validate();
    }

    public function describe(array $payload): array
    {
        $filter = self::filter($payload);

        return [
            'title' => 'approvals.audit_export.title',
            'subject_label' => null,
            'lines' => [
                ['label' => 'approvals.audit_export.format', 'after' => is_string($payload['format'] ?? null) ? $payload['format'] : null],
                ['label' => 'approvals.audit_export.from', 'after' => $filter['from'] ?? null],
                ['label' => 'approvals.audit_export.to', 'after' => $filter['to'] ?? null],
                ['label' => 'approvals.audit_export.action', 'after' => $filter['action'] ?? null],
                ['label' => 'approvals.audit_export.actor', 'after' => isset($filter['actor_type']) ? $filter['actor_type'].(isset($filter['actor_id']) ? ':'.$filter['actor_id'] : '') : null],
                ['label' => 'approvals.audit_export.target', 'after' => isset($filter['target_type']) ? $filter['target_type'].(isset($filter['target_id']) ? ':'.$filter['target_id'] : '') : null],
            ],
        ];
    }

    public function execute(ApprovalRequest $request, Staff $approver): array
    {
        FourEyes::handler($request, $approver, 'audit.export');
        $payload = $request->payload;
        $format = ($payload['format'] ?? 'csv') === 'jsonl' ? 'jsonl' : 'csv';
        $query = $this->query(self::filter($payload));
        $rows = (clone $query)->count();
        $max = config()->integer('speedclub.approvals.audit_export_max_rows');

        if ($rows > $max) {
            throw ValidationException::withMessages(['filter' => ["The filter matches $rows events; narrow it to at most $max."]]);
        }

        $path = config()->string('speedclub.approvals.disk_prefix').'/'.$request->id.'.'.$format;
        $stream = fopen('php://temp', 'w+b') ?: throw new RuntimeException('Could not open a temporary stream.');

        if ($format === 'csv') {
            fputcsv($stream, self::COLUMNS, escape: '');
        }

        foreach ($query->select(self::COLUMNS)->lazyById(1000) as $row) {
            $values = (array) $row;
            $format === 'csv'
                ? fputcsv($stream, CsvCell::row($values), escape: '')
                : fwrite($stream, json_encode($values, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n");
        }

        rewind($stream);
        $written = Storage::disk(config()->string('speedclub.media.private_disk'))->put($path, $stream);
        fclose($stream);

        if ($written === false) {
            throw new RuntimeException("Could not write $path.");
        }

        Audit::record('audit.exported', $request, after: [
            'format' => $format,
            'rows' => $rows,
            'filter' => self::filter($payload),
            'requested_by' => $request->requested_by,
            'approved_by' => $approver->getKey(),
        ], reason: $request->reason, actor: $approver);

        return [
            'file' => $path,
            'format' => $format,
            'rows' => $rows,
            'download_until' => now()->addHours(config()->integer('speedclub.approvals.download_hours'))->toIso8601String(),
        ];
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

    /**
     * @param  array<string, string>  $filter
     */
    private function query(array $filter): Builder
    {
        $zone = config()->string('speedclub.display_timezone');
        $query = DB::table('audit_events');

        foreach (['actor_type', 'actor_id', 'target_type', 'target_id'] as $column) {
            if (isset($filter[$column])) {
                $query->where($column, $filter[$column]);
            }
        }

        if (isset($filter['action'])) {
            $query->where('action', 'like', str_replace(['\\', '%', '_'], ['\\\\', '\%', '\_'], $filter['action']).'%');
        }

        if (isset($filter['from'])) {
            $query->where('occurred_at', '>=', Carbon::parse($filter['from'], $zone)->startOfDay()->utc()->format('Y-m-d H:i:s'));
        }

        if (isset($filter['to'])) {
            $query->where('occurred_at', '<', Carbon::parse($filter['to'], $zone)->addDay()->startOfDay()->utc()->format('Y-m-d H:i:s'));
        }

        return $query;
    }
}
