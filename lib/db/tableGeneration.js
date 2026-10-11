'use strict';

// v1.386.0 speed pass (W3): a per-table write counter kept by SQLite itself, so a read cache can tell, with one
// tiny query, whether a table changed since the cache was built.
//
// The counter lives in a TEMP table of the connection and three TEMP triggers bump it on every INSERT, UPDATE and
// DELETE of the watched table - whoever writes (a store method, a raw statement, a restore's DELETE FROM, a
// migration's backfill), the counter moves; a rolled-back write rolls its bump back with it. TEMP objects belong
// to the connection and are never written to the database file, so nothing about the stored schema changes. They
// are (re)installed whenever the adapter's connection object is new (a reopen drops them) or one has gone missing.
//
// `generation()` returns the counter, or null when it cannot be trusted (no connection, or the install failed):
// a caller must then read the table directly and cache nothing.

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function createTableGeneration(adapter, table) {
  if (!IDENT.test(table)) throw new Error(`tableGeneration: '${table}' is not a plain table name`);
  const triggers = ['ins', 'upd', 'del'].map((k) => `ft_gen_${table}_${k}`);
  let installedOn = null; // the connection the triggers were installed on
  let readStmt = null;
  let checkStmt = null;

  function install(sql) {
    sql.exec('CREATE TEMP TABLE IF NOT EXISTS ft_table_gen (name TEXT PRIMARY KEY, gen INTEGER NOT NULL)');
    sql.prepare('INSERT OR IGNORE INTO ft_table_gen (name, gen) VALUES (?, 0)').run(table);
    // a (re)install cannot vouch for writes made while a trigger was missing: move the counter so any snapshot
    // built before now is discarded
    sql.prepare('UPDATE ft_table_gen SET gen = gen + 1 WHERE name = ?').run(table);
    const bump = `UPDATE ft_table_gen SET gen = gen + 1 WHERE name = '${table}';`;
    sql.exec(`CREATE TEMP TRIGGER IF NOT EXISTS ${triggers[0]} AFTER INSERT ON main.${table} BEGIN ${bump} END`);
    sql.exec(`CREATE TEMP TRIGGER IF NOT EXISTS ${triggers[1]} AFTER UPDATE ON main.${table} BEGIN ${bump} END`);
    sql.exec(`CREATE TEMP TRIGGER IF NOT EXISTS ${triggers[2]} AFTER DELETE ON main.${table} BEGIN ${bump} END`);
    readStmt = sql.prepare('SELECT gen FROM ft_table_gen WHERE name = ?');
    checkStmt = sql.prepare(`SELECT COUNT(*) AS n FROM sqlite_temp_master WHERE type = 'trigger' AND name IN ('${triggers.join("', '")}')`);
    installedOn = sql;
  }

  function generation() {
    const sql = adapter && adapter.sql;
    if (!sql) return null;
    try {
      if (installedOn !== sql || checkStmt.get().n !== triggers.length) install(sql);
      const row = readStmt.get(table);
      return row ? Number(row.gen) : null;
    } catch (_) {
      installedOn = null;
      return null;
    }
  }

  return { generation, triggers };
}

module.exports = { createTableGeneration };
