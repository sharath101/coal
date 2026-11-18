/** Tidies a person's name as typed: trims it and collapses runs of spaces. */
export function normalizePersonName(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ');
}
