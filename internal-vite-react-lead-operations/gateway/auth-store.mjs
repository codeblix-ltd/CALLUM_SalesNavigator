import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const AUTH_ROW_ID = "primary";

export class EncryptedAuthStore {
  constructor({ databaseUrl, encryptionKey, codexHome, disabled = false }) {
    this.codexHome = codexHome;
    this.authPath = path.join(codexHome, "auth.json");
    this.key = decodeEncryptionKey(encryptionKey);
    this.disabled = disabled;
    this.pool = disabled
      ? null
      : new pg.Pool({
          connectionString: databaseUrl,
          ssl: { rejectUnauthorized: true },
          max: 2,
          idleTimeoutMillis: 20_000,
          connectionTimeoutMillis: 10_000,
          options: "--statement_timeout=10000",
        });
  }

  async initialize() {
    await mkdir(this.codexHome, { recursive: true, mode: 0o700 });
    await chmod(this.codexHome, 0o700).catch(() => {});
    if (this.disabled) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS codex_gateway_auth (
        id STRING PRIMARY KEY,
        encrypted_auth BYTES NOT NULL,
        nonce BYTES NOT NULL,
        auth_tag BYTES NOT NULL,
        plaintext_sha256 STRING NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT codex_gateway_auth_singleton CHECK (id = 'primary')
      )
    `);
  }

  async restoreIfMissing() {
    if (this.disabled) return false;
    if (await fileExists(this.authPath)) {
      await chmod(this.authPath, 0o600).catch(() => {});
      return false;
    }

    const result = await this.pool.query(
      `SELECT encrypted_auth, nonce, auth_tag, plaintext_sha256
         FROM codex_gateway_auth
        WHERE id = $1`,
      [AUTH_ROW_ID],
    );
    const row = result.rows[0];
    if (!row) return false;

    const plaintext = decrypt(
      this.key,
      Buffer.from(row.encrypted_auth),
      Buffer.from(row.nonce),
      Buffer.from(row.auth_tag),
    );
    const digest = sha256(plaintext);
    if (digest !== row.plaintext_sha256) {
      throw new Error("The encrypted Codex auth backup failed its integrity check.");
    }
    JSON.parse(plaintext.toString("utf8"));
    await atomicWrite(this.authPath, plaintext);
    return true;
  }

  async backupIfPresent() {
    if (this.disabled) return false;
    if (!(await fileExists(this.authPath))) return false;
    const plaintext = await readFile(this.authPath);
    JSON.parse(plaintext.toString("utf8"));
    const encrypted = encrypt(this.key, plaintext);
    await this.pool.query(
      `UPSERT INTO codex_gateway_auth (
         id,
         encrypted_auth,
         nonce,
         auth_tag,
         plaintext_sha256,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, now())`,
      [
        AUTH_ROW_ID,
        encrypted.ciphertext,
        encrypted.nonce,
        encrypted.authTag,
        sha256(plaintext),
      ],
    );
    return true;
  }

  async clear() {
    await unlink(this.authPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    if (!this.disabled) {
      await this.pool.query(
        "DELETE FROM codex_gateway_auth WHERE id = $1",
        [AUTH_ROW_ID],
      );
    }
  }

  async close() {
    await this.pool?.end();
  }
}

function decodeEncryptionKey(value) {
  let key;
  try {
    key = Buffer.from(value, "base64");
  } catch {
    throw new Error("CODEX_AUTH_ENCRYPTION_KEY must be a base64 value.");
  }
  if (key.length !== 32) {
    throw new Error(
      "CODEX_AUTH_ENCRYPTION_KEY must decode to exactly 32 bytes.",
    );
  }
  return key;
}

function encrypt(key, plaintext) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { ciphertext, nonce, authTag: cipher.getAuthTag() };
}

function decrypt(key, ciphertext, nonce, authTag) {
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function atomicWrite(target, contents) {
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, target);
  await chmod(target, 0o600).catch(() => {});
}

async function fileExists(value) {
  try {
    await stat(value);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
