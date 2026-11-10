<?php

namespace App\Services\PublicPages;

use App\Models\User;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;
use Illuminate\Contracts\Queue\ShouldQueue;

final class DrawMemberOgImage extends OgImageJob implements ShouldBeUniqueUntilProcessing, ShouldQueue
{
    public function __construct(public readonly string $memberId) {}

    public function uniqueId(): string
    {
        return 'member:'.$this->memberId;
    }

    protected function subject(): ?User
    {
        return User::withTrashed()->with(OgImages::MEMBER_RELATIONS)->find($this->memberId);
    }
}
