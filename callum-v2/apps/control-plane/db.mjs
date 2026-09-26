import pg from 'pg';

export function openDatabase(url = process.env.COCKROACH_DATABASE_URL) {
  if (!url) throw new Error('COCKROACH_DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000 });
  return {
    query: (sql, args) => pool.query(sql, args),
    async tx(fn) {
      const maxAttempts = 8;
      const client = await pool.connect();
      let committed = false;
      try {
        await client.query('BEGIN');
        await client.query('SAVEPOINT cockroach_restart');
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          let value;
          try {
            value = await fn(client);
            // In CockroachDB, releasing this special savepoint is the commit point.
            await client.query('RELEASE SAVEPOINT cockroach_restart');
          } catch (error) {
            if (error.code !== '40001' || attempt === maxAttempts - 1) throw error;
            await client.query('ROLLBACK TO SAVEPOINT cockroach_restart');
            const backoffMs = Math.min(500, 25 * 2 ** attempt) + Math.floor(Math.random() * 25);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            continue;
          }
          await client.query('COMMIT');
          committed = true;
          return value;
        }
      } finally {
        if (!committed) await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    },
    close: () => pool.end()
  };
}
