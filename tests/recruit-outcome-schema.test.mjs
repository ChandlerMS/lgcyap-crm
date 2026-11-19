import test from 'node:test';import assert from 'node:assert/strict';
import {ensureRecruitOutcomeSchema} from '../lib/recruit-outcome-schema.mjs';
function fixture({wrongPortal=false,conflict=false}={}) {
 const stages=[{id:'1',label:'Application',displayOrder:0,metadata:{ticketState:'OPEN'}},{id:'1473318773',label:'Withdrawn',displayOrder:1,metadata:{ticketState:conflict?'OPEN':'CLOSED'}}];
 const property={name:'recruiting_lifecycle_stage',type:'enumeration',options:[{value:'application',label:'Application',displayOrder:0,hidden:false}]};const writes=[];
 const fetchImpl=async(url,init)=>{const path=new URL(url).pathname;let result;
 if(path.endsWith('access-token-info'))result={hubId:wrongPortal?1:50894788,appId:59264745};
 else if(path.endsWith('/stages')){writes.push({path,body:JSON.parse(init.body)});result={id:'3',...JSON.parse(init.body)};stages.push(result);}
 else if(path.includes('/pipelines/'))result={id:'924992938',label:'Recruiting',stages:structuredClone(stages)};
 else if(init.method==='PATCH'){writes.push({path,body:JSON.parse(init.body)});property.options=JSON.parse(init.body).options;result=property;}
 else result=property;
 return new Response(JSON.stringify(result));};return{fetchImpl,writes,stages,property};
}
test('adds only missing stage/options and a repeated setup has no writes',async()=>{const h=fixture();assert.deepEqual(await ensureRecruitOutcomeSchema({accessToken:'synthetic',fetchImpl:h.fetchImpl}),{rejected:'3',withdrawn:'1473318773'});assert.equal(h.writes.length,2);assert.equal(h.stages[0].label,'Application');assert.deepEqual(h.property.options.map(o=>o.value),['application','rejected','withdrawn']);await ensureRecruitOutcomeSchema({accessToken:'synthetic',fetchImpl:h.fetchImpl});assert.equal(h.writes.length,2);});
test('wrong portal and conflicting existing stages fail before schema writes',async()=>{for(const options of [{wrongPortal:true},{conflict:true}]){const h=fixture(options);await assert.rejects(ensureRecruitOutcomeSchema({accessToken:'synthetic',fetchImpl:h.fetchImpl}));assert.equal(h.writes.length,0);}});
