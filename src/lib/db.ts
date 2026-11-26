import { createClient, type Client } from "@libsql/client";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  google_sub TEXT UNIQUE,
  email TEXT,
  name TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  uploads_playlist_id TEXT,
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_expires_at INTEGER,
  is_demo INTEGER NOT NULL DEFAULT 0,
  reach_metrics INTEGER,
  last_synced_at TEXT,
  last_sync_error TEXT
);
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  category_id TEXT,
  privacy_status TEXT,
  published_at TEXT,
  thumbnail_hash TEXT,
  first_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS videos_channel ON videos(channel_id);
CREATE TABLE IF NOT EXISTS thumbnails (
  hash TEXT NOT NULL,
  video_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (hash, video_id)
);
-- field: title | description | tags | category | privacy | thumbnail | note
CREATE TABLE IF NOT EXISTS changes (
  id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(id),
  channel_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  detected_at TEXT NOT NULL,
  change_date TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS changes_video ON changes(video_id, detected_at);
CREATE INDEX IF NOT EXISTS changes_channel ON changes(channel_id, detected_at);
CREATE TABLE IF NOT EXISTS daily_metrics (
  video_id TEXT NOT NULL,
  date TEXT NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  watch_minutes REAL NOT NULL DEFAULT 0,
  avg_view_duration REAL NOT NULL DEFAULT 0,
  subs_gained INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER,
  ctr REAL,
  PRIMARY KEY (video_id, date)
);
-- Audience retention curve for one video over a date range; points is JSON RetentionPoint[].
CREATE TABLE IF NOT EXISTS retention_curves (
  video_id TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  points TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (video_id, start_date, end_date)
);
`;

/** Columns added after the first release. Adding one that already exists throws, which is fine. */
const MIGRATIONS = [
  // Scheduled release time; YouTube only reports it while a video is private and scheduled.
  "ALTER TABLE videos ADD COLUMN publish_at TEXT",
  // 'manual' for changes and notes the creator recorded by hand (deletable); NULL for ones a sync detected.
  "ALTER TABLE changes ADD COLUMN source TEXT",
  // Average percentage of the video watched per view; NULL for days synced before it was collected.
  "ALTER TABLE daily_metrics ADD COLUMN avg_view_pct REAL",
];

async function migrate(c: Client) {
  for (const sql of MIGRATIONS) {
    try {
      await c.execute(sql);
    } catch (e) {
      if (!/duplicate column/i.test(String(e))) throw e;
    }
  }
}

let client: Client | undefined;
let ready: Promise<void> | undefined;

/** Local SQLite file by default; point DATABASE_URL at Turso/libSQL in production. */
export async function db(): Promise<Client> {
  if (!client) {
    client = createClient({
      url: process.env.DATABASE_URL ?? "file:testtube.db",
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
    ready = client.executeMultiple(SCHEMA).then(() => migrate(client!));
  }
  await ready;
  return client;
}
