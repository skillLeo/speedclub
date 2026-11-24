<?php

use App\Enums\CrewJoinMode;
use App\Enums\CrewRole;
use App\Models\Crew;
use App\Models\CrewMember;
use App\Models\FeatureFlag;
use App\Models\User;
use App\Services\Crews\CrewMemberships;

require_once __DIR__.'/../Garage/GarageTestHelpers.php';
require_once __DIR__.'/../Social/SocialTestHelpers.php';

/**
 * R4-2.3 crew test helpers, prefixed crew… so they never collide with another file's functions.
 */
function crewFlags(array $flags = []): void
{
    foreach ([...['crews' => true, 'editorial_samples' => true], ...$flags] as $key => $enabled) {
        FeatureFlag::query()->updateOrCreate(['key' => $key], ['enabled' => $enabled, 'description' => $key]);
    }

    request()->attributes->remove('speedclub.flags');
}

function crewMake(?User $founder = null, array $attributes = [], CrewJoinMode $mode = CrewJoinMode::Open): Crew
{
    return Crew::factory()->joinMode($mode)->foundedBy($founder)->create($attributes)->refresh();
}

function crewAdd(Crew $crew, User $user, CrewRole $role = CrewRole::Member): CrewMember
{
    $member = CrewMember::factory()->role($role)->create(['crew_id' => $crew->id, 'user_id' => $user->id]);
    app(CrewMemberships::class)->recount($crew);

    return $member;
}

function crewFounder(Crew $crew): User
{
    $id = CrewMember::query()->where('crew_id', $crew->id)->where('role', CrewRole::Founder->value)->value('user_id');

    return User::query()->findOrFail($id);
}
