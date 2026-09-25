import pg from 'pg';

export function openDatabase(url = process.env.COCKROACH_DATABASE_URL) {
  if (!url) throw new Error('COCKROACH_DATABASE_URL is required');
  const pool = new pg.Pool({ connectionString: url, max: 4, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000 });
  return {
    query: (sql, args) => pool.query(sql, args),
    async tx(fn) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const value = await fn(client);
          await client.query('COMMIT');
          return value;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          if (error.code !== '40001' || attempt === 4) throw error;
          await new Promise(resolve => setTimeout(resolve, 15 * (attempt + 1)));
        } finally { client.release(); }
      }
    },
    close: () => pool.end()
  };
}
