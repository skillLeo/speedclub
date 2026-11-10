<?php

namespace App\Events;

/**
 * The other member read up to message_id: on private-conversation.{id}, only while read receipts apply (both send them, no request).
 */
final class ConversationRead extends MessagingEvent {}
