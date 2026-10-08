import { test } from 'node:test';
import assert from 'node:assert/strict';
import {analyzeQuery,checkMigration,suggestIndexes,explainPlan,healthReport,maskSQL} from '../src/doctor.ts';
const has=(r:{findings:{code:string}[]},c:string)=>r.findings.some(x=>x.code===c);
const queryCases:[string,string,string][]=[
 ['wildcard','SELECT * FROM users','SELECT_STAR'],
 ['qualified wildcard','SELECT u.* FROM users u','SELECT_STAR'],
 ['update all','UPDATE users SET active=false','UNBOUNDED_WRITE'],
 ['delete all','DELETE FROM users','UNBOUNDED_WRITE'],
 ['deep offset','SELECT id FROM users OFFSET 10000','DEEP_OFFSET'],
 ['function filter','SELECT id FROM users WHERE lower(email) = $1','FUNCTION_PREDICATE'],
 ['unordered limit','SELECT id FROM users LIMIT 10','UNORDERED_LIMIT'],
 ['cross join','SELECT u.id FROM users u CROSS JOIN teams t','CROSS_JOIN'],
 ['not in nulls','SELECT id FROM users WHERE id NOT IN (SELECT uid FROM jobs)','NULL_NOT_IN'],
 ['random sort','SELECT id FROM users ORDER BY random()','RANDOM_SORT']
];
for(const [name,sql,code] of queryCases)test(name,()=>assert.ok(has(analyzeQuery(sql),code)));
const migrationCases:[string,string,string][]=[
 ['drop table','DROP TABLE users','DESTRUCTIVE_DDL'],['drop column','ALTER TABLE users DROP COLUMN email','DESTRUCTIVE_DDL'],
 ['truncate','TRUNCATE users','DESTRUCTIVE_DDL'],['type conversion','ALTER TABLE users ALTER COLUMN id TYPE bigint','COLUMN_TYPE_CHANGE'],
 ['not null','ALTER TABLE users ALTER COLUMN email SET NOT NULL','NOT_NULL_CHANGE'],
 ['blocking index','CREATE INDEX ON users(email)','BLOCKING_INDEX'],
 ['concurrent transaction','BEGIN; CREATE INDEX CONCURRENTLY ON users(email); COMMIT','CONCURRENT_INDEX_TRANSACTION'],
 ['unique validation','CREATE UNIQUE INDEX CONCURRENTLY ON users(email)','UNIQUE_INDEX_DATA'],
 ['foreign key validation','ALTER TABLE jobs ADD CONSTRAINT fk FOREIGN KEY(uid) REFERENCES users(id)','CONSTRAINT_VALIDATION'],
 ['volatile default','ALTER TABLE users ADD COLUMN rank float DEFAULT random()','VOLATILE_DEFAULT'],
 ['cascade','DROP TABLE users CASCADE','CASCADE']
];
for(const [name,sql,code] of migrationCases)test(name,()=>assert.ok(has(checkMigration(sql),code)));
test('bounded writes',()=>assert.equal(has(analyzeQuery('UPDATE users SET active=false WHERE id=$1'),'UNBOUNDED_WRITE'),false));
test('strings do not masquerade as WHERE',()=>assert.ok(has(analyzeQuery("UPDATE users SET note='where id=1'"),'UNBOUNDED_WRITE')));
test('comments and nested comments ignored',()=>assert.equal(checkMigration('/* DROP TABLE a /* DROP TABLE b */ */ SELECT 1').findings.length,0));
test('dollar quote semicolons ignored',()=>assert.equal(checkMigration('DO $body$ BEGIN DROP TABLE users; END $body$;').findings.length,0));
test('quoted identifier keywords ignored',()=>assert.ok(has(analyzeQuery('UPDATE "where" SET "where"=1'),'UNBOUNDED_WRITE')));
test('escaped E literal',()=>assert.equal(analyzeQuery("SELECT E'foo\\\' DROP TABLE t' AS x").findings.length,0));
test('unterminated quotes rejected',()=>assert.throws(()=>maskSQL("SELECT 'oops")));
test('unterminated comment rejected',()=>assert.throws(()=>maskSQL('/* missing')));
test('empty rejected',()=>assert.throws(()=>analyzeQuery('   ')));
test('size cap',()=>assert.throws(()=>analyzeQuery('x'.repeat(100001))));
test('stable limit',()=>assert.equal(has(analyzeQuery('SELECT id FROM users ORDER BY id LIMIT 5'),'UNORDERED_LIMIT'),false));
test('concurrent outside transaction',()=>assert.equal(has(checkMigration('CREATE INDEX CONCURRENTLY ON users(email)'),'BLOCKING_INDEX'),false));
test('commit resets transaction',()=>assert.equal(has(checkMigration('BEGIN; COMMIT; CREATE INDEX CONCURRENTLY ON users(email)'),'CONCURRENT_INDEX_TRANSACTION'),false));
test('not valid avoids immediate validation',()=>assert.equal(has(checkMigration('ALTER TABLE jobs ADD FOREIGN KEY(uid) REFERENCES users(id) NOT VALID'),'CONSTRAINT_VALIDATION'),false));
test('statement numbers',()=>assert.equal(checkMigration('SELECT 1; DROP TABLE t').findings[0].statement,2));
test('index candidate',()=>assert.equal(suggestIndexes('SELECT id FROM public.users WHERE email=$1').candidates[0].ddl,'CREATE INDEX CONCURRENTLY ON "public"."users" ("email");'));
test('index deduplication',()=>assert.equal(suggestIndexes('SELECT id FROM users WHERE email=$1 AND email=$2').candidates.length,1));
test('existing leading index',()=>assert.equal(suggestIndexes('SELECT id FROM users WHERE email=$1',[{table:'users',columns:['email','id']}]).candidates.length,0));
test('existing non-leading column insufficient',()=>assert.equal(suggestIndexes('SELECT id FROM users WHERE email=$1',[{table:'users',columns:['id','email']}]).candidates.length,1));
test('join refuses inference',()=>assert.equal(suggestIndexes('SELECT u.id FROM users u JOIN jobs j ON j.uid=u.id WHERE email=$1').candidates.length,0));
test('quoted names refuse inference',()=>assert.equal(suggestIndexes('SELECT id FROM "users" WHERE email=$1').candidates.length,0));
test('multi statement inference refused',()=>assert.equal(suggestIndexes('SELECT id FROM users WHERE email=$1; SELECT 1').candidates.length,0));
test('large seq scan',()=>assert.ok(has(explainPlan([{Plan:{'Node Type':'Seq Scan','Plan Rows':20000}}]),'LARGE_SEQ_SCAN')));
test('small seq scan no warning',()=>assert.equal(explainPlan({Plan:{'Node Type':'Seq Scan','Plan Rows':5}}).findings.length,0));
test('nested plans and actual rows',()=>{const r=explainPlan([{Plan:{'Node Type':'Nested Loop',Plans:[{'Node Type':'Index Scan','Plan Rows':1,'Actual Rows':100,'Actual Loops':1000}]},'Execution Time':12.5}]);assert.equal(r.nodeCount,2);assert.equal(r.executionTimeMs,12.5);assert.ok(has(r,'ROW_ESTIMATE_ERROR'));assert.ok(has(r,'HIGH_LOOPS'));});
test('sort spill',()=>assert.ok(has(explainPlan({Plan:{'Node Type':'Sort','Sort Method':'external merge'}}),'SORT_SPILL')));
test('invalid plan rejected',()=>assert.throws(()=>explainPlan('{}')));
test('malformed child rejected',()=>assert.throws(()=>explainPlan({Plan:{'Node Type':'Sort',Plans:[null]}})));
test('aggregate',()=>{const r=healthReport({queries:['SELECT * FROM users'],migrations:['DROP TABLE users']});assert.equal(r.findings.length,2);assert.equal(r.analyzed.queries,1);});
test('empty health rejected',()=>assert.throws(()=>healthReport({})));
test('health batch cap',()=>assert.throws(()=>healthReport({queries:Array(101).fill('SELECT 1')})));
