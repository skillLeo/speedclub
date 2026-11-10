/**
 * The password of a registration, until the code arrives: verifying needs code and password together (ADR-135), and a guest
 * has no session that could stand in for it. Memory only, never a parameter and never storage. An app that was killed or a
 * reloaded page has lost it, and AUTH-05 then asks for it again.
 */
let pending: { email: string; password: string } | null = null;

export function holdRegistrationPassword(email: string, password: string): void {
  pending = { email, password };
}

export function registrationPasswordFor(email: string): string | null {
  return pending?.email === email ? pending.password : null;
}

export function clearRegistrationPassword(): void {
  pending = null;
}
