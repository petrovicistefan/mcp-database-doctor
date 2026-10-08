#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { analyzeQuery, checkMigration, suggestIndexes, explainPlan, healthReport } from './doctor.js';
export function createServer() {
 const server=new McpServer({name:'mcp-database-doctor',version:'0.1.0'});
 const sql=z.string().trim().min(1).max(100000);
 const annotations={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
 const wrap=(fn:()=>unknown)=>{try{const output=fn() as Record<string,unknown>;return {content:[{type:'text' as const,text:JSON.stringify(output)}],structuredContent:output};}catch(error){return {isError:true,content:[{type:'text' as const,text:error instanceof Error?error.message:'Analysis failed.'}]};}};
 server.registerTool('analyze_query',{description:'Offline PostgreSQL SQL heuristics. No execution; no finding is not proof of safety.',inputSchema:{sql},annotations},async a=>wrap(()=>analyzeQuery(a.sql)));
 server.registerTool('check_migration',{description:'Review PostgreSQL migration SQL for destructive operations, lock/rewrite risks and transaction conflicts. Does not execute.',inputSchema:{sql},annotations},async a=>wrap(()=>checkMigration(a.sql)));
 server.registerTool('suggest_indexes',{description:'Conservative index candidates for single unquoted table queries. Requires EXPLAIN validation; never applies DDL.',inputSchema:{sql,existingIndexes:z.array(z.object({table:z.string().max(256),columns:z.array(z.string().max(256)).max(100)})).max(1000).optional()},annotations},async a=>wrap(()=>suggestIndexes(a.sql,a.existingIndexes)));
 server.registerTool('explain_plan',{description:'Interpret a supplied PostgreSQL EXPLAIN FORMAT JSON plan. Does not run EXPLAIN ANALYZE.',inputSchema:{plan:z.string().min(1).max(1000000)},annotations},async a=>wrap(()=>explainPlan(a.plan)));
 server.registerTool('health_report',{description:'Aggregate diagnostics over supplied artifacts, not live database health.',inputSchema:{queries:z.array(sql).max(100).optional(),migrations:z.array(sql).max(100).optional(),plans:z.array(z.string().max(1000000)).max(100).optional()},annotations},async a=>wrap(()=>healthReport(a)));
 return server;
}
await createServer().connect(new StdioServerTransport());
