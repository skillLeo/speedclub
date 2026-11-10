<?php

namespace App\Events;

/**
 * [SIG sig.msg_typing] The other member is typing: on private-conversation.{id}; message_id is null. Never for a pending request.
 */
final class Typing extends MessagingEvent {}
