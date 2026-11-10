<?php

namespace App\Events;

/**
 * A new message in a conversation: on private-conversation.{id} and on private-user.{recipient}.
 */
final class MessageSent extends MessagingEvent {}
