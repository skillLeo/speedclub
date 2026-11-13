<?php

namespace App\Services\Social;

/**
 * What ViewerStates keeps on the request: items registered but not loaded yet, and the loaded states, both keyed "type:id".
 */
final class ViewerStateMemo
{
    /** @var array<string, array{0: 'vehicle'|'build_update', 1: string}> */
    public array $pending = [];

    /** @var array<string, array{saved: bool, reaction: string|null}> */
    public array $states = [];
}
