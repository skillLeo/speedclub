<?php

use App\Enums\MediaStatus;
use App\Enums\ModerationStatus;
use App\Enums\RestrictionType;
use App\Enums\Visibility;
use App\Models\AuditEvent;
use App\Models\Block;
use App\Models\Brand;
use App\Models\BuildUpdate;
use App\Models\CatalogRequest;
use App\Models\ConfigVersion;
use App\Models\FeatureFlag;
use App\Models\Follow;
use App\Models\Generation;
use App\Models\IdempotencyKey;
use App\Models\LegalDocument;
use App\Models\Make;
use App\Models\Media;
use App\Models\ModCategory;
use App\Models\ModCategoryField;
use App\Models\Modification;
use App\Models\PersonalAccessToken;
use App\Models\PushToken;
use App\Models\QrScanDaily;
use App\Models\Save;
use App\Models\User;
use App\Models\Vehicle;
use App\Models\VehicleModel;
use App\Models\VehicleSearch;
use App\Models\VehicleSpec;
use App\Models\VerificationCode;
use Illuminate\Support\Facades\Gate;

function can(?User $user, string $ability, mixed $arguments): bool
{
    return Gate::forUser($user)->allows($ability, $arguments);
}

function blockedWith(User $owner): User
{
    $user = User::factory()->create();
    Block::factory()->create(['blocker_id' => $owner->id, 'blocked_id' => $user->id]);

    return $user;
}

describe('vehicle visibility', function () {
    it('shows a vehicle by state to guest, other member and owner', function (Closure $state, bool $others) {
        $vehicle = $state(Vehicle::factory())->create();

        expect(can(null, 'view', $vehicle))->toBe($others)
            ->and(can(User::factory()->create(), 'view', $vehicle))->toBe($others)
            ->and(can($vehicle->owner, 'view', $vehicle))->toBeTrue();
    })->with([
        'draft' => [fn ($factory) => $factory, false],
        'published public' => [fn ($factory) => $factory->published(), true],
        'unlisted reachable by link' => [fn ($factory) => $factory->unlisted(), true],
        'private' => [fn ($factory) => $factory->private(), false],
        'archived' => [fn ($factory) => $factory->archived(), false],
    ]);

    it('hides a deleted vehicle from everyone', function () {
        $vehicle = Vehicle::factory()->published()->create();
        $vehicle->delete();

        expect(can(null, 'view', $vehicle))->toBeFalse()
            ->and(can($vehicle->owner, 'view', $vehicle))->toBeFalse();
    });

    it('hides vehicles across a block in both directions', function () {
        $vehicle = Vehicle::factory()->published()->create();
        $blockedByOwner = blockedWith($vehicle->owner);
        $blocksOwner = User::factory()->create();
        Block::factory()->create(['blocker_id' => $blocksOwner->id, 'blocked_id' => $vehicle->owner_id]);

        expect(can($blockedByOwner, 'view', $vehicle))->toBeFalse()
            ->and(can($blocksOwner, 'view', $vehicle))->toBeFalse()
            ->and(can(null, 'view', $vehicle))->toBeTrue();
    });

    it('hides vehicles of suspended, deactivated and deleted owners', function (Closure $owner) {
        $vehicle = Vehicle::factory()->published()->create(['owner_id' => $owner()->id]);

        expect(can(null, 'view', $vehicle))->toBeFalse()
            ->and(can(User::factory()->create(), 'view', $vehicle))->toBeFalse();
    })->with([
        'suspended' => [fn () => User::factory()->suspended()->create()],
        'deactivated' => [fn () => User::factory()->deactivated()->create()],
        'soft deleted' => [function () {
            $user = User::factory()->create();
            $user->delete();

            return $user;
        }],
    ]);

    it('keeps showing vehicles after a suspension has lapsed', function () {
        $vehicle = Vehicle::factory()->published()->create(['owner_id' => User::factory()->suspended(now()->subDay())->create()->id]);

        expect(can(null, 'view', $vehicle))->toBeTrue();
    });
});

describe('vehicle writes', function () {
    it('allows only the owner to write', function () {
        $vehicle = Vehicle::factory()->create();
        $other = User::factory()->create();

        foreach (['update', 'delete', 'publish'] as $ability) {
            expect(can($vehicle->owner, $ability, $vehicle))->toBeTrue($ability)
                ->and(can($other, $ability, $vehicle))->toBeFalse($ability)
                ->and(can(null, $ability, $vehicle))->toBeFalse($ability);
        }
    });

    it('allows drafts but not publishing before the email is verified', function () {
        $user = User::factory()->unverified()->create();
        $vehicle = Vehicle::factory()->create(['owner_id' => $user->id]);

        expect(can($user, 'create', Vehicle::class))->toBeTrue()
            ->and(can($user, 'update', $vehicle))->toBeTrue()
            ->and(can($user, 'publish', $vehicle))->toBeFalse();
    });

    it('lets the owner ask again for a published vehicle, which PublishVehicle answers without a change (ADR-176a), and nobody else', function () {
        $vehicle = Vehicle::factory()->published()->create();
        $restricted = Vehicle::factory()->published()->create(['owner_id' => User::factory()->restrictedFrom(RestrictionType::Publishing)->create()->id]);
        $unverified = Vehicle::factory()->published()->create(['owner_id' => User::factory()->unverified()->create()->id]);

        expect(can($vehicle->owner, 'publish', $vehicle))->toBeTrue()
            ->and(can(User::factory()->create(), 'publish', $vehicle))->toBeFalse()
            ->and(can($restricted->owner, 'publish', $restricted))->toBeFalse()
            ->and(can($unverified->owner, 'publish', $unverified))->toBeFalse();
    });

    it('stops content writes under a publishing restriction but leaves take-down', function () {
        $user = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
        $vehicle = Vehicle::factory()->published()->create(['owner_id' => $user->id]);
        $update = BuildUpdate::factory()->create(['vehicle_id' => $vehicle->id]);

        expect(can($user, 'create', Vehicle::class))->toBeFalse()
            ->and(can($user, 'update', $vehicle))->toBeFalse()
            ->and(can($user, 'create', [Modification::class, $vehicle]))->toBeFalse()
            ->and(can($user, 'create', Media::class))->toBeFalse()
            ->and(can($user, 'changeVisibility', [$vehicle, Visibility::Public]))->toBeFalse()
            ->and(can($user, 'changeVisibility', [$vehicle, Visibility::Private]))->toBeTrue()
            ->and(can($user, 'delete', $vehicle))->toBeTrue()
            ->and(can($user, 'update', $update))->toBeTrue();
    });

    it('does not stop vehicle writes under a messaging restriction', function () {
        $user = User::factory()->restrictedFrom(RestrictionType::Messaging)->create();
        $vehicle = Vehicle::factory()->create(['owner_id' => $user->id]);

        expect(can($user, 'update', $vehicle))->toBeTrue();
    });

    it('stops all content writes for a suspended owner but leaves deletion', function () {
        $user = User::factory()->suspended()->create();
        $vehicle = Vehicle::factory()->published()->create(['owner_id' => $user->id]);

        expect(can($user, 'create', Vehicle::class))->toBeFalse()
            ->and(can($user, 'update', $vehicle))->toBeFalse()
            ->and(can($user, 'reissueQr', $vehicle))->toBeFalse()
            ->and(can($user, 'delete', $vehicle))->toBeTrue();
    });

    it('stops everything for a deactivated account', function () {
        $user = User::factory()->deactivated()->create();
        $vehicle = Vehicle::factory()->published()->create(['owner_id' => $user->id]);

        foreach (['view', 'update', 'delete', 'publish', 'setMain', 'reissueQr'] as $ability) {
            expect(can($user, $ability, $vehicle))->toBeFalse($ability);
        }
    });

    it('makes only a published vehicle the main vehicle', function () {
        $published = Vehicle::factory()->published()->create();
        $draft = Vehicle::factory()->create();

        expect(can($published->owner, 'setMain', $published))->toBeTrue()
            ->and(can($draft->owner, 'setMain', $draft))->toBeFalse();
    });

    it('never restores or force deletes for members', function () {
        $vehicle = Vehicle::factory()->create();

        expect(can($vehicle->owner, 'restore', $vehicle))->toBeFalse()
            ->and(can($vehicle->owner, 'forceDelete', $vehicle))->toBeFalse();
    });
});

describe('content on a vehicle', function () {
    it('follows the vehicle for specs', function () {
        $spec = VehicleSpec::factory()->create(['vehicle_id' => Vehicle::factory()->private()]);

        expect(can(null, 'view', $spec))->toBeFalse()
            ->and(can($spec->vehicle->owner, 'view', $spec))->toBeTrue()
            ->and(can($spec->vehicle->owner, 'update', $spec))->toBeTrue()
            ->and(can(User::factory()->create(), 'update', $spec))->toBeFalse();
    });

    it('follows the vehicle for modifications', function () {
        $public = Modification::factory()->create(['vehicle_id' => Vehicle::factory()->published()]);
        $private = Modification::factory()->create(['vehicle_id' => Vehicle::factory()->private()]);
        $other = User::factory()->create();

        expect(can(null, 'view', $public))->toBeTrue()
            ->and(can($other, 'view', $private))->toBeFalse()
            ->and(can($private->vehicle->owner, 'view', $private))->toBeTrue()
            ->and(can($other, 'update', $public))->toBeFalse()
            ->and(can($other, 'delete', $public))->toBeFalse()
            ->and(can($other, 'create', [Modification::class, $public->vehicle]))->toBeFalse()
            ->and(can($public->vehicle->owner, 'create', [Modification::class, $public->vehicle]))->toBeTrue()
            ->and(can($public->vehicle->owner, 'update', $public))->toBeTrue()
            ->and(can($public->vehicle->owner, 'delete', $public))->toBeTrue();
    });

    it('hides a deleted modification', function () {
        $mod = Modification::factory()->create(['vehicle_id' => Vehicle::factory()->published()]);
        $mod->delete();

        expect(can(null, 'view', $mod))->toBeFalse()
            ->and(can($mod->vehicle->owner, 'update', $mod))->toBeFalse();
    });

    it('hides hidden build updates from everyone but the owner', function () {
        $update = BuildUpdate::factory()->create(['vehicle_id' => Vehicle::factory()->published(), 'hidden' => true]);
        $visible = BuildUpdate::factory()->create(['vehicle_id' => $update->vehicle_id]);
        $other = User::factory()->create();

        expect(can(null, 'view', $update))->toBeFalse()
            ->and(can($other, 'view', $update))->toBeFalse()
            ->and(can($update->vehicle->owner, 'view', $update))->toBeTrue()
            ->and(can(null, 'view', $visible))->toBeTrue()
            ->and(can($other, 'update', $visible))->toBeFalse()
            ->and(can($visible->vehicle->owner, 'update', $visible))->toBeTrue()
            ->and(can($visible->vehicle->owner, 'create', [BuildUpdate::class, $visible->vehicle]))->toBeTrue()
            ->and(can($other, 'create', [BuildUpdate::class, $visible->vehicle]))->toBeFalse();
    });
});

describe('media', function () {
    it('shows media of a visible parent to others', function () {
        $vehicle = Vehicle::factory()->published()->create();
        $media = Media::factory()->forModel($vehicle)->create(['owner_id' => $vehicle->owner_id]);
        $mod = Modification::factory()->create(['vehicle_id' => $vehicle->id]);
        $modMedia = Media::factory()->forModel($mod)->create(['owner_id' => $vehicle->owner_id]);

        expect(can(null, 'view', $media))->toBeTrue()
            ->and(can(User::factory()->create(), 'view', $modMedia))->toBeTrue();
    });

    it('hides media of a private vehicle from others', function () {
        $vehicle = Vehicle::factory()->private()->create();
        $media = Media::factory()->forModel($vehicle)->create(['owner_id' => $vehicle->owner_id]);

        expect(can(null, 'view', $media))->toBeFalse()
            ->and(can($vehicle->owner, 'view', $media))->toBeTrue();
    });

    it('hides unfinished and rejected media from others but not the owner', function (array $state) {
        $vehicle = Vehicle::factory()->published()->create();
        $media = Media::factory()->forModel($vehicle)->create(['owner_id' => $vehicle->owner_id, ...$state]);

        expect(can(null, 'view', $media))->toBeFalse()
            ->and(can($vehicle->owner, 'view', $media))->toBeTrue();
    })->with([
        'processing' => [['status' => MediaStatus::Processing]],
        'failed' => [['status' => MediaStatus::Failed]],
        'rejected' => [['moderation_status' => ModerationStatus::Rejected]],
    ]);

    it('keeps unattached uploads with the owner', function () {
        $media = Media::factory()->create();

        expect(can(null, 'view', $media))->toBeFalse()
            ->and(can(User::factory()->create(), 'view', $media))->toBeFalse()
            ->and(can($media->owner, 'view', $media))->toBeTrue();
    });

    it('shows an avatar like the member page, blocks included', function () {
        $user = User::factory()->create();
        $avatar = Media::factory()->forModel($user)->create(['owner_id' => $user->id]);

        expect(can(null, 'view', $avatar))->toBeTrue()
            ->and(can(blockedWith($user), 'view', $avatar))->toBeFalse();
    });

    it('lets only the owner change media, with the right restriction', function () {
        $media = Media::factory()->create();
        $restricted = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
        $restrictedMedia = Media::factory()->create(['owner_id' => $restricted->id]);
        $other = User::factory()->create();

        expect(can($media->owner, 'update', $media))->toBeTrue()
            ->and(can($media->owner, 'delete', $media))->toBeTrue()
            ->and(can($other, 'update', $media))->toBeFalse()
            ->and(can($other, 'delete', $media))->toBeFalse()
            ->and(can($restricted, 'update', $restrictedMedia))->toBeFalse()
            ->and(can($restricted, 'delete', $restrictedMedia))->toBeTrue()
            ->and(can($other, 'create', Media::class))->toBeTrue()
            ->and(can(null, 'create', Media::class))->toBeFalse();
    });
});

describe('members', function () {
    it('shows a member page to guests and members, not across a block', function () {
        $member = User::factory()->create();

        expect(can(null, 'view', $member))->toBeTrue()
            ->and(can(User::factory()->create(), 'view', $member))->toBeTrue()
            ->and(can($member, 'view', $member))->toBeTrue()
            ->and(can(blockedWith($member), 'view', $member))->toBeFalse();
    });

    it('hides suspended and deactivated members from others', function (Closure $state) {
        $member = $state();

        expect(can(null, 'view', $member))->toBeFalse()
            ->and(can(User::factory()->create(), 'view', $member))->toBeFalse();
    })->with([
        'suspended' => [fn () => User::factory()->suspended()->create()],
        'deactivated' => [fn () => User::factory()->deactivated()->create()],
    ]);

    it('lets a member change only their own account', function () {
        $member = User::factory()->create();
        $other = User::factory()->create();

        foreach (['update', 'updateProfile', 'delete'] as $ability) {
            expect(can($member, $ability, $member))->toBeTrue($ability)
                ->and(can($other, $ability, $member))->toBeFalse($ability)
                ->and(can(null, $ability, $member))->toBeFalse($ability);
        }
    });

    it('leaves settings and deletion open under restrictions, but not the public profile', function (Closure $state) {
        $member = $state();

        expect(can($member, 'update', $member))->toBeTrue()
            ->and(can($member, 'delete', $member))->toBeTrue()
            ->and(can($member, 'updateProfile', $member))->toBeFalse();
    })->with([
        'publishing restricted' => [fn () => User::factory()->restrictedFrom(RestrictionType::Publishing)->create()],
        'suspended' => [fn () => User::factory()->suspended()->create()],
    ]);
});

describe('follows', function () {
    it('allows a verified member to follow', function () {
        expect(can(User::factory()->create(), 'create', [Follow::class, User::factory()->create()]))->toBeTrue();
    });

    it('denies a follow', function (Closure $actor) {
        $target = User::factory()->create();

        expect(can($actor($target), 'create', [Follow::class, $target]))->toBeFalse();
    })->with([
        'guest' => [fn () => null],
        'self' => [fn (User $target) => $target],
        'unverified' => [fn () => User::factory()->unverified()->create()],
        'suspended' => [fn () => User::factory()->suspended()->create()],
        'blocked' => [fn (User $target) => blockedWith($target)],
    ]);

    it('denies following a suspended member', function () {
        expect(can(User::factory()->create(), 'create', [Follow::class, User::factory()->suspended()->create()]))->toBeFalse();
    });

    it('lets both sides end a follow, nobody else', function () {
        $follow = Follow::factory()->create();

        expect(can($follow->follower, 'delete', $follow))->toBeTrue()
            ->and(can($follow->followee, 'delete', $follow))->toBeTrue()
            ->and(can(User::factory()->create(), 'delete', $follow))->toBeFalse();
    });
});

describe('blocks', function () {
    it('lets restricted and unverified members block, but not themselves', function () {
        $target = User::factory()->create();

        expect(can(User::factory()->unverified()->create(), 'create', [Block::class, $target]))->toBeTrue()
            ->and(can(User::factory()->suspended()->create(), 'create', [Block::class, $target]))->toBeTrue()
            ->and(can($target, 'create', [Block::class, $target]))->toBeFalse()
            ->and(can(null, 'create', [Block::class, $target]))->toBeFalse();
    });

    it('lets only the blocker unblock', function () {
        $block = Block::factory()->create();

        expect(can($block->blocker, 'delete', $block))->toBeTrue()
            ->and(can($block->blocked, 'delete', $block))->toBeFalse();
    });
});

describe('saves', function () {
    it('saves a visible build of someone else', function () {
        $vehicle = Vehicle::factory()->published()->create();

        expect(can(User::factory()->create(), 'create', [Save::class, $vehicle]))->toBeTrue()
            ->and(can(null, 'create', [Save::class, $vehicle]))->toBeFalse()
            ->and(can($vehicle->owner, 'create', [Save::class, $vehicle]))->toBeFalse()
            ->and(can(blockedWith($vehicle->owner), 'create', [Save::class, $vehicle]))->toBeFalse();
    });

    it('does not save a private build', function () {
        expect(can(User::factory()->create(), 'create', [Save::class, Vehicle::factory()->private()->create()]))->toBeFalse();
    });

    it('keeps a save private, also from the vehicle owner', function () {
        $save = Save::factory()->create();

        expect(can($save->user, 'view', $save))->toBeTrue()
            ->and(can($save->user, 'delete', $save))->toBeTrue()
            ->and(can($save->vehicle->owner, 'view', $save))->toBeFalse()
            ->and(can(User::factory()->create(), 'delete', $save))->toBeFalse();
    });
});

describe('QR', function () {
    it('shows codes and counts to the vehicle owner only', function () {
        $scan = QrScanDaily::factory()->create();
        $code = $scan->qrCode;
        $other = User::factory()->create();

        expect(can($code->vehicle->owner, 'view', $code))->toBeTrue()
            ->and(can($code->vehicle->owner, 'view', $scan))->toBeTrue()
            ->and(can($other, 'view', $code))->toBeFalse()
            ->and(can($other, 'view', $scan))->toBeFalse()
            ->and(can(null, 'view', $code))->toBeFalse();
    });

    it('lets the owner reissue, also under a publishing restriction', function () {
        $restricted = User::factory()->restrictedFrom(RestrictionType::Publishing)->create();
        $vehicle = Vehicle::factory()->published()->create(['owner_id' => $restricted->id]);
        $draft = Vehicle::factory()->create();

        expect(can($restricted, 'reissueQr', $vehicle))->toBeTrue()
            ->and(can(User::factory()->create(), 'reissueQr', $vehicle))->toBeFalse()
            ->and(can($draft->owner, 'reissueQr', $draft))->toBeFalse();
    });
});

describe('own records', function () {
    it('limits device tokens to their member', function () {
        $token = PersonalAccessToken::factory()->create();
        $owner = User::query()->findOrFail($token->tokenable_id);

        expect(can($owner, 'view', $token))->toBeTrue()
            ->and(can($owner, 'delete', $token))->toBeTrue()
            ->and(can(User::factory()->create(), 'view', $token))->toBeFalse()
            ->and(can(User::factory()->create(), 'delete', $token))->toBeFalse();
    });

    it('limits push tokens to their member', function () {
        $token = PushToken::factory()->create();

        expect(can($token->user, 'delete', $token))->toBeTrue()
            ->and(can(User::factory()->create(), 'delete', $token))->toBeFalse()
            ->and(can(User::factory()->create(), 'create', PushToken::class))->toBeTrue()
            ->and(can(null, 'create', PushToken::class))->toBeFalse();
    });

    it('limits catalogue requests to their member', function () {
        $request = CatalogRequest::factory()->create();

        expect(can($request->user, 'view', $request))->toBeTrue()
            ->and(can(User::factory()->create(), 'view', $request))->toBeFalse()
            ->and(can(User::factory()->unverified()->create(), 'create', CatalogRequest::class))->toBeTrue()
            ->and(can(User::factory()->suspended()->create(), 'create', CatalogRequest::class))->toBeFalse()
            ->and(can(null, 'create', CatalogRequest::class))->toBeFalse();
    });
});

describe('public reference data', function () {
    it('is readable by guests and not writable by members', function (string $model) {
        $record = $model::factory()->create();
        $member = User::factory()->create();

        expect(can(null, 'viewAny', $model))->toBeTrue()
            ->and(can(null, 'view', $record))->toBeTrue();

        foreach (['create', 'update', 'delete'] as $ability) {
            expect(can($member, $ability, $ability === 'create' ? $model : $record))->toBeFalse($ability);
        }
    })->with([Make::class, VehicleModel::class, Generation::class, Brand::class, ModCategory::class, ModCategoryField::class]);

    it('shows only published legal documents', function () {
        expect(can(null, 'view', LegalDocument::factory()->published()->create()))->toBeTrue()
            ->and(can(null, 'view', LegalDocument::factory()->create()))->toBeFalse()
            ->and(can(User::factory()->create(), 'update', LegalDocument::factory()->published()->create()))->toBeFalse();
    });

    it('answers for a single search row through the vehicle', function () {
        $public = VehicleSearch::factory()->create();
        $hidden = VehicleSearch::factory()->create(['is_public' => false]);

        expect(can(null, 'view', $public))->toBeTrue()
            ->and(can(null, 'view', $hidden))->toBeFalse()
            ->and(can(blockedWith($public->vehicle->owner), 'view', $public))->toBeFalse();
    });
});

describe('internal records', function () {
    it('denies members every ability', function (string $model) {
        $record = $model::factory()->create();
        $member = User::factory()->create();

        foreach (['viewAny', 'create'] as $ability) {
            expect(can($member, $ability, $model))->toBeFalse($ability);
        }

        foreach (['view', 'update', 'delete'] as $ability) {
            expect(can($member, $ability, $record))->toBeFalse($ability);
        }
    })->with([VerificationCode::class, IdempotencyKey::class, AuditEvent::class, ConfigVersion::class, FeatureFlag::class]);
});
