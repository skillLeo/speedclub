<?php

namespace App\Events;

/**
 * The member's counters changed (a new message, read on another device, accept, decline, delete): on private-user.{id}.
 */
final class UnreadChanged extends MessagingEvent {}
