/** Folds case, accents and separators, so "citroen" finds "Citroën" and "mercedesbenz" "Mercedes-Benz". */
export function foldName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
