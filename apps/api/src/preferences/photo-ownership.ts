/** Only the upload endpoint creates keys under this user's private namespace. */
export function ownsPreferencePhoto(userId: string, key: string): boolean {
  const prefix = `preferences/${userId}/`;
  if (!key.startsWith(prefix)) return false;
  return /^[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(key.slice(prefix.length));
}

export function ownedPreferencePhotos(userId: string, keys: readonly string[]): string[] {
  return [...new Set(keys.filter((key) => ownsPreferencePhoto(userId, key)))];
}
