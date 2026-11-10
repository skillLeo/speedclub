<?php

namespace App\Models;

use App\Enums\NotificationType;
use Database\Factories\NotificationFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

/**
 * A row of HOME-02 (M2.2). Written by App\Services\Notifications\Notifier only, so nothing is fillable. created_at is the latest event of
 * the row: a grouped row moves up, and becomes unread again, when somebody joins it.
 *
 * @property string $id
 * @property NotificationType $type
 * @property string $notifiable_id the recipient
 * @property string|null $group_key
 * @property string|null $actor_id the latest actor
 * @property int $actor_count every actor the row was ever about (for build_saved: how many saved it)
 * @property string|null $vehicle_id
 * @property array<string, mixed>|null $data language-free, by type
 */
class Notification extends Model
{
    /** @use HasFactory<NotificationFactory> */
    use HasFactory, HasUlids;

    protected $guarded = ['*'];

    /**
     * Actors the reader may see now, set by NotificationFeed::hydrate. A plain property, never a column.
     */
    public int $visibleActorCount = 0;

    /**
     * followed_published: the ids of `update_ids` whose build updates are still shown, set by NotificationFeed::hydrate.
     *
     * @var list<string>
     */
    public array $visibleUpdateIds = [];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'type' => NotificationType::class,
            'data' => 'array',
            'actor_count' => 'integer',
            'read_at' => 'datetime',
            'pushed_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function recipient(): BelongsTo
    {
        return $this->belongsTo(User::class, 'notifiable_id')->withTrashed();
    }

    /**
     * @return BelongsTo<Vehicle, $this>
     */
    public function vehicle(): BelongsTo
    {
        return $this->belongsTo(Vehicle::class)->withTrashed();
    }

    /**
     * Everybody the row is about, newest first.
     *
     * @return BelongsToMany<User, $this>
     */
    public function actors(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'notification_actors', 'notification_id', 'actor_id')
            ->withPivot('created_at')
            ->orderByPivot('created_at', 'desc');
    }
}
