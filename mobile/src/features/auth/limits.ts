/**
 * The lengths of 02_PRODUCT_SPEC §3.1 on their own, without zod (M5.12a, 09 §12): the root's RecentAuthHost and the code fields need the
 * code length only, and importing schemas.ts for it put zod into the member web's first screen. schemas.ts re-exports them.
 */
/** The server's `max:255` on every e-mail field (StartEmailCodeRequest, RegisterRequest, LoginRequest). */
export const EMAIL_MAX_LENGTH = 255;
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 255;
export const USERNAME_MIN_LENGTH = 5;
export const USERNAME_MAX_LENGTH = 24;
/** R4B-004: the values of the username copy (`username.rules.length`, `username.reason.length`), so the text cannot drift from the rule. */
export const USERNAME_LENGTH_VALUES = { min: USERNAME_MIN_LENGTH, max: USERNAME_MAX_LENGTH } as const;
export const CODE_LENGTH = 6;
export const DISPLAY_NAME_MAX_LENGTH = 60;
export const CITY_MAX_LENGTH = 100;
