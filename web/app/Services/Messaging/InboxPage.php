<?php

namespace App\Services\Messaging;

use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Pagination\CursorPaginator;

/**
 * A cursor page of the inbox whose items are ConversationView: the cursor reads the member's participant row behind each view.
 *
 * @extends CursorPaginator<int, ConversationView>
 */
class InboxPage extends CursorPaginator
{
    /**
     * @param  mixed  $item
     * @return array<string, mixed>
     */
    public function getParametersForItem($item)
    {
        if ($item instanceof JsonResource) {
            $item = $item->resource;
        }

        return parent::getParametersForItem($item instanceof ConversationView ? $item->me : $item);
    }
}
