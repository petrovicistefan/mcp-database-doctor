export type Finding = { code: string; severity: 'high' | 'medium' | 'low'; message: string; recommendation: string; statement?: number };
export type Report = { dialect: 'postgresql'; mode: 'offline'; findings: Finding[]; status: 'review_required' | 'no_rules_triggered'; limitations: string[] };
const MAX_SQL = 100_000;
const limitations = ['Heuristic static analysis, not a PostgreSQL parser or proof of safety.', 'No SQL is executed. Validate recommendations against real schema, workload and PostgreSQL version.'];
function report(findings: Finding[]): Report { return { dialect: 'postgresql', mode: 'offline', findings, status: findings.length ? 'review_required' : 'no_rules_triggered', limitations }; }
function finding(code: string, severity: Finding['severity'], message: string, recommendation: string): Finding { return {code,severity,message,recommendation}; }
/** Mask comments and literals while preserving offsets and identifiers. Handle nested block comments and dollar quotes. */
export function maskSQL(sql: string): string {
  if (!sql.trim() || sql.length > MAX_SQL) throw new Error('SQL must contain 1–100000 characters.');
  let out = '', i = 0;
  while (i < sql.length) {
    if (sql.startsWith('--', i)) { const end = sql.indexOf('\n', i); const j = end < 0 ? sql.length : end; out += ' '.repeat(j-i); i=j; }
    else if (sql.startsWith('/*', i)) { const start=i; let depth=1; i+=2; while(i<sql.length && depth) { if(sql.startsWith('/*',i)){depth++;i+=2;} else if(sql.startsWith('*/',i)){depth--;i+=2;} else i++; } if(depth) throw new Error('Unterminated block comment.'); out+=' '.repeat(i-start); }
    else if (sql[i] === "'") { const start=i++; const escaped = start>0 && /[eE]/.test(sql[start-1]) && (start<2 || !/\w/.test(sql[start-2])); let closed=false; while(i<sql.length){if(escaped && sql[i]==='\\'){i+=2;continue;} if(sql[i]==="'"){if(sql[i+1]==="'"){i+=2;continue;} i++;closed=true;break;} i++;} if(!closed) throw new Error('Unterminated SQL string.'); out+=' '.repeat(i-start); }
    else if (sql[i] === '"') { const start=i++; let closed=false; while(i<sql.length){if(sql[i]==='"'){if(sql[i+1]==='"'){i+=2;continue;}i++;closed=true;break;}i++;} if(!closed)throw new Error('Unterminated quoted identifier.'); out+='Q'.repeat(i-start); }
    else if (sql[i] === '$' && /^\$(?:[A-Za-z_][\w]*)?\$/.test(sql.slice(i))) { const tag=sql.slice(i).match(/^\$(?:[A-Za-z_][\w]*)?\$/)![0]; const end=sql.indexOf(tag,i+tag.length); if(end<0)throw new Error('Unterminated dollar quote.'); const j=end+tag.length;out+=' '.repeat(j-i);i=j; }
    else out+=sql[i++];
  }
  return out;
}
function statements(sql: string): string[] { return maskSQL(sql).split(';').map(s=>s.trim()).filter(Boolean); }
export function analyzeQuery(sql: string): Report {
  const findings: Finding[]=[];
  statements(sql).forEach((s,index)=>{
    const add=(c:string,v:Finding['severity'],m:string,r:string)=>findings.push({...finding(c,v,m,r),statement:index+1});
    if (/\bselect\s+(?:distinct\s+)?(?:\w+\.)?\*/i.test(s)) add('SELECT_STAR','low','Wildcard projection increases coupling and may read unnecessary columns.','Select only columns required by the caller.');
    if (/^\s*(?:update|delete\s+from)\b/i.test(s) && !/\bwhere\b/i.test(s)) add('UNBOUNDED_WRITE','high','Write statement has no WHERE clause.','Confirm full-table intent and test affected row count before applying.');
    if (/\boffset\s+(\d+)/i.test(s) && Number(s.match(/\boffset\s+(\d+)/i)![1])>=10000) add('DEEP_OFFSET','medium','Large OFFSET discards many preceding rows.','Consider keyset pagination on a stable unique ordering.');
    if (/\b(?:lower|upper|date|coalesce)\s*\([^)]*\)\s*(?:=|>|<|like)/i.test(s)) add('FUNCTION_PREDICATE','medium','Function predicate may not match a plain column index.','Check EXPLAIN; consider a matching expression index or equivalent range predicate.');
    if (/\blimit\b/i.test(s)&&! /\border\s+by\b/i.test(s)) add('UNORDERED_LIMIT','low','LIMIT has no explicit ordering.','Use ORDER BY with a unique tie-breaker when stable results matter.');
    if (/\bcross\s+join\b/i.test(s)) add('CROSS_JOIN','medium','Explicit cross join can multiply row counts.','Confirm intended cardinality with EXPLAIN.');
    if (/\bnot\s+in\s*\(\s*select\b/i.test(s)) add('NULL_NOT_IN','medium','NOT IN subquery can produce unexpected results with NULLs.','Validate NULL semantics; consider a correlated NOT EXISTS.');
    if (/\border\s+by\s+random\s*\(/i.test(s)) add('RANDOM_SORT','medium','Random ordering can require sorting all qualifying rows.','Consider sampling strategies if exact random ordering is unnecessary.');
  }); return report(findings);
}
export function checkMigration(sql: string): Report {
 const findings:Finding[]=[]; const stmts=statements(sql); let transaction=false;
 stmts.forEach((s,index)=>{
  const add=(c:string,v:Finding['severity'],m:string,r:string)=>findings.push({...finding(c,v,m,r),statement:index+1});
  if (/^(?:begin|start\s+transaction)\b/i.test(s)) transaction=true;
  if (/\b(?:drop\s+(?:table|schema|database|column)|truncate\b)/i.test(s)) add('DESTRUCTIVE_DDL','high','Migration removes data or schema objects.','Require a verified backup, impact review and explicit rollback strategy.');
  if (/\balter\s+column\b[\s\S]*\btype\b/i.test(s)) add('COLUMN_TYPE_CHANGE','high','Column type change may rewrite data and hold strong locks.','Check cast compatibility and lock/rewrite behavior; use a staged migration for large tables.');
  if (/\bset\s+not\s+null\b/i.test(s) || /\badd\s+(?:column\s+)?\w+\s+\w+[\s\S]*\bnot\s+null\b/i.test(s)) add('NOT_NULL_CHANGE','medium','NOT NULL change requires existing rows to satisfy the constraint.','Backfill and validate existing data; assess table scan and locking requirements.');
  if (/\bcreate\s+(?:unique\s+)?index\b/i.test(s)) {
    if (!/\bconcurrently\b/i.test(s)) add('BLOCKING_INDEX','medium','Normal index creation blocks writes to the table.','For an online table consider CREATE INDEX CONCURRENTLY and its operational tradeoffs.');
    else if(transaction) add('CONCURRENT_INDEX_TRANSACTION','high','CREATE INDEX CONCURRENTLY cannot run inside a transaction block.','Run this statement outside the migration transaction.');
    if (/\bunique\b/i.test(s)) add('UNIQUE_INDEX_DATA','medium','Unique index requires compatible existing data.','Check duplicates and NULL semantics before applying.');
  }
  if (/\badd\s+(?:constraint\s+\w+\s+)?(?:foreign\s+key|check\s*\()/i.test(s)&&! /\bnot\s+valid\b/i.test(s)) add('CONSTRAINT_VALIDATION','medium','Constraint addition may validate existing rows while holding locks.','Consider NOT VALID followed by VALIDATE CONSTRAINT where PostgreSQL supports it.');
  if (/\bdefault\s+(?:random|clock_timestamp|nextval)\s*\(/i.test(s)) add('VOLATILE_DEFAULT','high','Volatile default may require a table rewrite.','Add the column without a volatile default and backfill in bounded batches.');
  if (/\bcascade\b/i.test(s)) add('CASCADE','high','CASCADE can affect dependent objects.','Enumerate dependencies before applying.');
  if (/^(?:commit|rollback|end)\b/i.test(s)) transaction=false;
 }); return report(findings);
}
export type IndexCandidate = {table:string; column:string; ddl:string; reason:string};
export function suggestIndexes(sql:string, existingIndexes: {table:string; columns:string[]}[]=[]): {candidates:IndexCandidate[]; limitations:string[]} {
 const s=maskSQL(sql); const candidates:IndexCandidate[]=[];
 // Deliberately refuse ambiguous joins/subqueries/quoted names rather than guess table ownership.
 const tables=[...s.matchAll(/\b(?:from|join)\s+([a-z_][\w]*(?:\.[a-z_][\w]*)?)/gi)];
 if(tables.length!==1 || /\bjoin\b/i.test(s) || /Q{2}/.test(s) || statements(sql).length!==1) return {candidates,limitations:[...limitations,'Index inference supports one unquoted table and no joins/subqueries.']};
 const table=tables[0][1]; const where=s.match(/\bwhere\b([\s\S]*?)(?:\border\s+by\b|\bgroup\s+by\b|\blimit\b|$)/i)?.[1]??'';
 const cols=[...where.matchAll(/(?:^|\band\b|\bor\b|\()\s*(?:[a-z_]\w*\.)?([a-z_]\w*)\s*(?:=|>=|<=|>|<|\bin\s*\()/gi)].map(m=>m[1]);
 for(const column of new Set(cols)) {
   if(existingIndexes.some(x=>x.table.toLowerCase()===table.toLowerCase()&&x.columns[0]?.toLowerCase()===column.toLowerCase()))continue;
   const quote=(x:string)=>'"'+x.replaceAll('"','""')+'"';
   candidates.push({table,column,ddl:`CREATE INDEX CONCURRENTLY ON ${table.split('.').map(quote).join('.')} (${quote(column)});`,reason:'Predicate column; candidate only. Validate selectivity, existing expression/partial indexes, write cost and EXPLAIN.'});
 } return {candidates,limitations};
}
export function explainPlan(input: unknown): Report & { nodeCount:number; executionTimeMs?:number } {
 let data:unknown=input;
 if(typeof data==='string'){if(data.length>1_000_000)throw new Error('Plan exceeds 1 MB.');data=JSON.parse(data);}
 const root=Array.isArray(data)?data[0]:data;
 if(!root || typeof root!=='object' || !('Plan' in root))throw new Error('Expected PostgreSQL EXPLAIN (FORMAT JSON) object or array.');
 const findings:Finding[]=[];let nodeCount=0;const stack:unknown[]=[(root as Record<string,unknown>).Plan];
 while(stack.length){const raw=stack.pop();if(!raw || typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid plan node.');const node=raw as Record<string,unknown>;if(++nodeCount>10000)throw new Error('Plan exceeds 10000 nodes.');if(typeof node['Node Type']!=='string')throw new Error('Missing Node Type.');
 const n=(key:string)=>typeof node[key]==='number'&&Number.isFinite(node[key])?node[key] as number:undefined;
 if(node['Node Type']==='Seq Scan' && (n('Plan Rows')??0)>=10000) findings.push(finding('LARGE_SEQ_SCAN','medium','Sequential scan has at least 10000 estimated output rows.','Seq scans may be optimal; compare selectivity, table size and index alternatives.'));
 const estimated=n('Plan Rows'),actual=n('Actual Rows');if(estimated!==undefined&&actual!==undefined&&Math.max(estimated,actual)>=100&&Math.max(estimated,actual)/Math.max(1,Math.min(estimated,actual))>=10) findings.push(finding('ROW_ESTIMATE_ERROR','medium','Estimated and actual per-loop rows differ by at least 10×.','Review ANALYZE statistics, correlated columns and parameter sensitivity.'));
 if(typeof node['Sort Method']==='string'&&/external/i.test(node['Sort Method']))findings.push(finding('SORT_SPILL','medium','Sort spilled to disk.','Reduce input rows or review per-query work_mem within a concurrency budget.'));
 if((n('Actual Loops')??0)>=1000) findings.push(finding('HIGH_LOOPS','medium','Plan node executes at least 1000 loops.','Inspect cumulative work and join strategy using rows × loops.'));
 if(node.Plans!==undefined){if(!Array.isArray(node.Plans))throw new Error('Plans must be an array.');stack.push(...node.Plans);}
 }
 const time=(root as Record<string,unknown>)['Execution Time']; return {...report(findings),nodeCount,...(typeof time==='number'&&Number.isFinite(time)?{executionTimeMs:time}:{})};
}
export function healthReport(input:{queries?:string[];migrations?:string[];plans?:unknown[]}): Report & { scope:string; analyzed:{queries:number;migrations:number;plans:number} } {
 const queries=input.queries??[],migrations=input.migrations??[],plans=input.plans??[];
 if(!queries.length&&!migrations.length&&!plans.length)throw new Error('Provide at least one query, migration or plan.');
 if(queries.length+migrations.length+plans.length>100)throw new Error('Maximum 100 inputs.');
 const findings=[...queries.flatMap((q,i)=>analyzeQuery(q).findings.map(f=>({...f,message:`Query ${i+1}: ${f.message}`}))),...migrations.flatMap((q,i)=>checkMigration(q).findings.map(f=>({...f,message:`Migration ${i+1}: ${f.message}`}))),...plans.flatMap((q,i)=>explainPlan(q).findings.map(f=>({...f,message:`Plan ${i+1}: ${f.message}`})))];
 return {...report(findings),scope:'Supplied artifacts only; not a live database health assessment.',analyzed:{queries:queries.length,migrations:migrations.length,plans:plans.length}};
}
