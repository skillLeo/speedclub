<?php

namespace App\Services\Moderation;

use App\Enums\ReportTargetType;
use App\Models\BuildUpdate;
use App\Models\Comment;
use App\Models\Event;
use App\Models\Media;
use App\Models\Message;
use App\Models\Modification;
use App\Models\User;
use App\Models\Vehicle;

/**
 * A report target as the server found it: the row, the member it belongs to, the language-free label SET-16 shows ("@paul.roadster",
 * "Mazda MX-5 ND") and a text snapshot for the case (ADM-22), taken when it was reported so a later edit or delete cannot erase it.
 */
final readonly class ResolvedTarget
{
    /**
     * @param  array<string, mixed>  $snapshot
     */
    public function __construct(
        public ReportTargetType $type,
        public User|Vehicle|Media|BuildUpdate|Modification|Message|Comment|Event $model,
        public ?string $subjectId,
        public string $label,
        public array $snapshot,
    ) {}

    public function id(): string
    {
        return (string) $this->model->getKey();
    }
}
