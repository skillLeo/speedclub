<?php

namespace App\Http\Resources\V1;

use App\Enums\ReportTargetType;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * What a report or decision is about, as it was called when reported: the type and a language-free label ("@paul.roadster" for a member
 * or the sender of a message, the build's title for a build and its photos, mods and updates). The client writes "Foto von …". The
 * label may be empty when the name was gone (a deleted account); the content itself may be gone by now.
 */
class SafetyTargetResource extends JsonResource
{
    private ReportTargetType $type = ReportTargetType::Member;

    private string $label = '';

    public static function of(ReportTargetType $type, ?string $label): self
    {
        // A non-null resource: nested inside another resource, a JsonResource of null renders as null.
        $target = new self([]);
        $target->type = $type;
        $target->label = $label ?? '';

        return $target;
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            /** @var ReportTargetType */
            'type' => $this->type,
            /** @var string */
            'label' => $this->label,
        ];
    }
}
