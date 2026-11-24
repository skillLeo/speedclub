<?php

namespace App\Services\Forum;

use App\Models\ForumThread;

/**
 * Loads what ForumThreadResource reads for FOR-03 in one go.
 */
final class ForumThreadDetail
{
    public static function load(ForumThread $thread): ForumThread
    {
        return $thread->load([
            'category', 'user.avatar', 'lastPoster.avatar',
            'vehicle.make', 'vehicle.vehicleModel', 'vehicle.generation', 'vehicle.cover', 'vehicle.owner',
            'openingPost.photos', 'solvedPost.user.avatar', 'mergedInto', 'modification.vehicle', 'product.brand',
        ]);
    }
}
