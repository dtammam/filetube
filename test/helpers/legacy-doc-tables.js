'use strict';

// Wave 7 of the relational-migration arc (schema v33) DROPPED the two
// document tables (`doc_kv`, `doc_single`). The migration tests still model a
// real pre-v33 database: they rewind a fresh file's stamp below the block
// under test and plant the namespace's legacy doc rows by raw SQL, then
// reopen and watch the block drain them. After v33 a fresh file has no doc
// tables to plant into, so a rewind re-creates them first - with the SAME DDL
// the v1 block used (exported by lib/db/sqlite.js for exactly this caller),
// so the planted rows sit where a real v1.42-v1.295 file kept them. The
// reopen then runs the drains and, last, v33's drop again.
//
// `countLegacyDocTables(sql)` is the post-migration assertion: 0 means v33
// ran (and, because v33 REFUSES to drop a non-empty table, that every drain
// before it deleted its rows - the skipped ones included).

const { __LEGACY_DOC_TABLES_DDL_FOR_TESTS: DDL } = require('../../lib/db/sqlite');

function ensureLegacyDocTables(sql) {
  sql.exec(DDL);
}

function countLegacyDocTables(sql) {
  return sql.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name IN ('doc_kv', 'doc_single')").get().c;
}

module.exports = { ensureLegacyDocTables, countLegacyDocTables };
