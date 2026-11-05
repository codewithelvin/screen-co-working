function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`environment variable ${name} is required`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  apiKey: required('LIVEKIT_API_KEY'),
  apiSecret: required('LIVEKIT_API_SECRET'),
  /** How this API reaches LiveKit (inside the compose network). */
  livekitInternalUrl: process.env.LIVEKIT_INTERNAL_URL ?? 'http://livekit:7880',
  /** What desktop clients connect to; empty = same host as the API, port 7880. */
  livekitPublicUrl: process.env.LIVEKIT_PUBLIC_URL ?? '',
  updatesDir: process.env.UPDATES_DIR ?? '/data/updates',
  /** Apps below this version may not join. Empty = take `minVersion` from updates/latest.json. */
  minClientVersion: process.env.MIN_CLIENT_VERSION ?? '',
  /** LiveKit room-name prefix; keeps our rooms apart when the LiveKit is shared. */
  roomPrefix: process.env.ROOM_PREFIX ?? 'scw-',
  /** Wi-Fi fingerprint similarity (0..1) from which two people count as next to each other (D37). */
  proximityThreshold: Number(process.env.PROXIMITY_THRESHOLD ?? 0.5),
  /** A fingerprint older than this no longer counts (clients report every 20 s). */
  fingerprintMaxAgeMs: Number(process.env.FINGERPRINT_MAX_AGE_MS ?? 90_000),
  /**
   * Someone whose Wi-Fi scan Windows refuses (location off) gets their own mic, starting muted.
   * Set to "1" to give them no mic until location is on. Off since the second live test
   * (2026-11-05): office PCs had location off and people could not talk at all.
   */
  noMicWhenLocationUnknown: process.env.NO_MIC_WHEN_LOCATION_UNKNOWN === '1',
  voiceIntervalMs: Number(process.env.VOICE_INTERVAL_MS ?? 5_000),
};
