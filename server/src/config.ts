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
};
