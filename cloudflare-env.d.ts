declare namespace Cloudflare {
  interface Env {
    HUBSPOT_ACCESS_TOKEN?: string;
    RECRUITING_EDITOR_EMAILS?: string;
    RECRUITING_WRITES_ENABLED?: string;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
