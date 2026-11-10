<?php

namespace App\Models;

use App\Enums\AuditActorType;
use Database\Factories\AuditEventFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use LogicException;

/**
 * Append-only, tamper-evident log (05_ARCHITECTURE §13): there is no update or delete path in code,
 * and database triggers reject both where the host allows them.
 */
#[Table(timestamps: false)]
#[Fillable([
    'occurred_at', 'actor_type', 'actor_id', 'action', 'target_type', 'target_id', 'before', 'after', 'reason',
    'request_id', 'prev_hash', 'hash',
])]
class AuditEvent extends Model
{
    /** @use HasFactory<AuditEventFactory> */
    use HasFactory;

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'occurred_at' => 'immutable_datetime',
            'actor_type' => AuditActorType::class,
            'before' => 'array',
            'after' => 'array',
        ];
    }

    /**
     * @param  Builder<static>  $query
     */
    protected function performUpdate(Builder $query): never
    {
        throw new LogicException('Audit events are append-only.');
    }

    protected function performDeleteOnModel(): never
    {
        throw new LogicException('Audit events are append-only.');
    }
}
