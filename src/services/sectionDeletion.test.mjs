// Real frontend service + fake provider. No HTTP or database execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('./sectionDeletion.ts',import.meta.url),'utf8');
const sandbox=vm.createContext({exports:{}});
vm.runInContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,sandbox);
const {deleteEmptySection}=sandbox.exports;
function fixture(respond=()=>({data:[],total:0}),remove=()=>({data:{id:42}})) {
    const calls=[];
    return {calls,provider:{
        async getList(args){calls.push({method:'GET',...args});return respond(args);},
        async deleteOne(args){calls.push({method:'DELETE',...args});return remove(args);},
    }};
}
test('empty section checks BOTH child relations with the same ID before one DELETE',async()=>{
    const {calls,provider}=fixture();
    await deleteEmptySection(42,provider);
    assert.deepEqual(calls.map(c=>[c.method,c.resource]),[['GET','tasks'],['GET','quality/template_task_inspection'],['DELETE','sections']]);
    assert.ok(calls.slice(0,2).every(c=>c.meta.queryParams.section_id===42&&c.pagination.mode==='off'));
    assert.equal(calls[2].id,42);
});
for(const relation of ['tasks','quality/template_task_inspection']) {
    test('nonempty '+relation+' blocks DELETE; children are never deleted automatically',async()=>{
        const {calls,provider}=fixture(({resource})=>({data:resource===relation?[{id:7}]:[],total:resource===relation?1:0}));
        await assert.rejects(deleteEmptySection(42,provider),e=>e.statusCode===409&&e.message.includes('actividades o puntos de inspección'));
        assert.equal(calls.filter(c=>c.method==='DELETE').length,0);
    });
}
for(const code of [400,403,500]) {
    test('dependency lookup HTTP '+code+' fails closed without DELETE',async()=>{
        const {calls,provider}=fixture(()=>{throw {message:'Cannot inspect dependencies',statusCode:code};});
        await assert.rejects(deleteEmptySection(42,provider),e=>e.statusCode===code);
        assert.equal(calls.filter(c=>c.method==='DELETE').length,0);
    });
}
test('malformed dependency response never authorizes deletion',async()=>{
    const {calls,provider}=fixture(()=>({data:{error:'unexpected'}}));
    await assert.rejects(deleteEmptySection(42,provider),e=>e.statusCode===502);
    assert.equal(calls.filter(c=>c.method==='DELETE').length,0);
});
for(const code of [409,500]) {
    test('DELETE HTTP '+code+' propagates failure rather than returning success',async()=>{
        const {calls,provider}=fixture(undefined,()=>{throw {message:'Delete rejected',statusCode:code};});
        await assert.rejects(deleteEmptySection(42,provider),e=>e.statusCode===code);
        assert.equal(calls.filter(c=>c.method==='DELETE').length,1);
    });
}
test('invalid IDs never reach the API',async()=>{
    const {calls,provider}=fixture();
    for(const id of [0,-1,1.5,NaN,Infinity,'42',2147483648])await assert.rejects(deleteEmptySection(id,provider),e=>e.statusCode===400);
    assert.equal(calls.length,0);
});
