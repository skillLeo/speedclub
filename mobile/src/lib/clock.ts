import { qa } from './qa';

/** The current time. Everything date-related goes through here so `qaNow` can freeze it. */
export function now(): Date {
  return qa.now ? new Date(qa.now.getTime()) : new Date();
}
