const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function randomFrom(alphabet: string, length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function newSlug(length = 8): string {
  return randomFrom(SLUG_ALPHABET, length);
}

export function newUploadId(): string {
  return randomFrom("abcdefghjkmnpqrstuvwxyz23456789", 16);
}

export function validSlug(slug: string): boolean {
  return /^[a-z2-9]{6,16}$/.test(slug);
}

export function validUploadId(id: string): boolean {
  return /^[a-z2-9]{16}$/.test(id);
}