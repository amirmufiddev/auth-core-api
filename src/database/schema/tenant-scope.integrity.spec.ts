import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Pool, type PoolClient } from 'pg';

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('tenant scope integrity', () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let client: PoolClient;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query('BEGIN');
  });

  afterAll(async () => {
    await client.query('ROLLBACK');
    client.release();
    await pool.end();
  });

  it('should accept a platform session, reject a mismatched session, block tenant delete, and allow suspend', async () => {
    const suffix = crypto.randomUUID();
    const platformUserId = `usr_p_${suffix}`;
    const tenantUserId = `usr_t_${suffix}`;
    const tierId = `tier_${suffix}`;
    const tenantId = `ten_${suffix}`;

    await client.query(
      `INSERT INTO auth_tiers (id, code, name) VALUES ($1, $2, 'Test')`,
      [tierId, `code_${suffix}`],
    );
    await client.query(
      `INSERT INTO "user" (id, name, email, tenant_id) VALUES ($1, 'Platform', $2, NULL)`,
      [platformUserId, `p_${suffix}@example.com`],
    );
    await client.query(
      `INSERT INTO tenant (id, name, slug, owner_user_id, tier_id) VALUES ($1, 'Acme', $2, $3, $4)`,
      [tenantId, `acme-${suffix}`, platformUserId, tierId],
    );
    await client.query(
      `INSERT INTO "user" (id, name, email, tenant_id) VALUES ($1, 'Asep', $2, $3)`,
      [tenantUserId, `t_${suffix}@example.com`, tenantId],
    );

    await client.query(
      `INSERT INTO session (id, expires_at, token, user_id, tenant_id)
       VALUES ($1, now() + interval '1 hour', $2, $3, NULL)`,
      [`ses_p_${suffix}`, `tok_p_${suffix}`, platformUserId],
    );

    await client.query('SAVEPOINT reject_mismatched_session');
    await expect(
      client.query(
        `INSERT INTO session (id, expires_at, token, user_id, tenant_id)
         VALUES ($1, now() + interval '1 hour', $2, $3, NULL)`,
        [`ses_bad_${suffix}`, `tok_bad_${suffix}`, tenantUserId],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await client.query('ROLLBACK TO SAVEPOINT reject_mismatched_session');

    await client.query(
      `INSERT INTO session (id, expires_at, token, user_id, tenant_id)
       VALUES ($1, now() + interval '1 hour', $2, $3, $4)`,
      [`ses_ok_${suffix}`, `tok_ok_${suffix}`, tenantUserId, tenantId],
    );

    await client.query('SAVEPOINT reject_tenant_delete');
    await expect(
      client.query(`DELETE FROM tenant WHERE id = $1`, [tenantId]),
    ).rejects.toMatchObject({ code: '23503' });
    await client.query('ROLLBACK TO SAVEPOINT reject_tenant_delete');

    const suspended = await client.query(
      `UPDATE tenant SET status = 'suspended' WHERE id = $1 RETURNING status`,
      [tenantId],
    );
    expect(suspended.rows[0].status).toBe('suspended');
  });
});