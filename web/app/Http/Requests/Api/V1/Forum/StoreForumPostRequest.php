<?php

namespace App\Http\Requests\Api\V1\Forum;

use App\Models\ForumPost;
use Illuminate\Foundation\Http\FormRequest;

/**
 * FOR-03 reply (Markdown subset, ≤ 5 000 characters); `parent_id` answers a reply (an answer to an answer joins its thread). The opening
 * post's text is edited through PATCH forum/threads/{thread} or here (≤ 10 000).
 */
class StoreForumPostRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $post = $this->route('post');
        $max = $post instanceof ForumPost && $post->is_opening ? config()->integer('speedclub.forum.opening_max') : config()->integer('speedclub.forum.reply_max');

        return [
            'body' => ['required', 'string', 'min:1', 'max:'.$max],
            'parent_id' => ['nullable', 'string', 'size:26'],
        ];
    }
}
