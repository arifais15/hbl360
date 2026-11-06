function translateSql(sql) {
  const pragma = sql.match(/^\s*PRAGMA\s+table_info\((\w+)\)\s*;?\s*$/i);
  if (pragma) {
    const tableName = pragma[1].replace(/'/g, "''");
    return {
      sql: `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${tableName}' ORDER BY ordinal_position`,
      isTableInfo: true
    };
  }

  const source = sql
    .replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'SERIAL PRIMARY KEY')
    .replace(/\bDATETIME\b/gi, 'TIMESTAMP')
    .replace(/\bREAL\b/gi, 'DOUBLE PRECISION')
    .replace(/\bsubstr\(([\w.]+),\s*1,\s*7\)/gi, "to_char($1::date, 'YYYY-MM')");
  let result = '';
  let parameterIndex = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      result += char;
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      result += char;
      if (char === '*' && next === '/') {
        result += next;
        index += 1;
        blockComment = false;
      }
      continue;
    }
    if (quote) {
      result += char === quote && quote === '`' ? '"' : char;
      if (char === quote && next === quote) {
        result += quote === '`' ? '"' : next;
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '-' && next === '-') {
      result += '--';
      index += 1;
      lineComment = true;
      continue;
    }
    if (char === '/' && next === '*') {
      result += '/*';
      index += 1;
      blockComment = true;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      result += char === '`' ? '"' : char;
      continue;
    }
    if (char === '?') {
      parameterIndex += 1;
      result += `$${parameterIndex}`;
      continue;
    }
    result += char;
  }

  return { sql: result, isTableInfo: false };
}

function insertReturningId(sql) {
  if (!/^\s*INSERT\s+INTO\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) return sql;
  return `${sql.replace(/;\s*$/, '')} RETURNING id`;
}

module.exports = { translateSql, insertReturningId };
