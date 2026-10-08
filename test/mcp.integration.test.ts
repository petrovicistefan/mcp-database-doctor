import {test,expect} from 'vitest';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
test('real MCP stdio handshake, discovery, tool calls and validation',async()=>{
 const transport=new StdioClientTransport({command:process.execPath,args:['dist/server.js']});
 const client=new Client({name:'database-doctor-test',version:'1.0.0'});
 try{
  await client.connect(transport);
  const tools=await client.listTools();expect(tools.tools.map(t=>t.name).sort()).toEqual(['analyze_query','check_migration','explain_plan','health_report','suggest_indexes']);
  const r=await client.callTool({name:'check_migration',arguments:{sql:'DROP TABLE users'}});expect(r.isError).not.toBe(true);expect(JSON.stringify(r)).toContain('DESTRUCTIVE_DDL');
  const invalid=await client.callTool({name:'explain_plan',arguments:{plan:'{}'}});expect(invalid.isError).toBe(true);
 }finally{await client.close();}
},15000);
