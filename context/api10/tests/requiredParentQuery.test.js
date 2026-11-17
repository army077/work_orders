// Invoke actual handlers with a fake pool. No HTTP requests, sockets or SQL engine.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
function load(file, respond) {
  const handlers = new Map(), calls = [], errors = [];
  const router = Object.fromEntries(['get','post','put','patch','delete'].map(method => [method,(path,handler) => handlers.set(method+' '+path,handler)]));
  const module = { exports: {} };
  vm.runInNewContext(readFileSync(join(__dirname,'../routes',file),'utf8'), {
    module, console: { log() {}, error(...args) { errors.push(args); } },
    require(name) {
      if (name === 'express') return { Router: () => router };
      if (name === '../db') return { async query(sql, params) { calls.push({sql,params}); return respond(sql, params); } };
      throw Error('UNEXPECTED_IMPORT:'+name);
    },
  });
  return { handlers, calls, errors };
}
const cases = [
  ['sections.js','/','template_id','template_section'],
  ['tasks.js','/','section_id','template_task'],
  ['quality.js','/template_task_inspection','section_id','template_task_inspection'],
];
for (const [file,path,key,table] of cases) {
  test(file+' rejects missing/invalid parent query before touching the pool', async () => {
    const app = load(file, () => assert.fail('DB must not be called'));
    for (const value of [undefined,null,'','0','-1','1.5','abc','NaN','Infinity',' 1 ','01','2147483648','9007199254740992',[],['1','2'],{id:'1'}]) {
      const res = { code:200, status(n){this.code=n;return this;}, json(body){this.body=body;return this;} };
      await app.handlers.get('get '+path)({query: value === undefined ? {} : {[key]:value}}, res);
      assert.equal(res.code,400,JSON.stringify(value));
      assert.ok(res.body.error.includes(key));assert.equal(app.calls.length,0);
    }
  });
  test(file+' passes a valid integer and returns the rows unchanged', async () => {
    const rows = [{id:910001}];
    const app = load(file, (sql,params) => { assert.ok(sql.includes('FROM '+table));assert.equal(params[0],910001);return {rows}; });
    const res = { json(body){this.body=body;return this;} };
    await app.handlers.get('get '+path)({query:{[key]:'910001'}},res);
    assert.equal(res.body,rows);assert.equal(app.calls.length,1);
  });
  test(file+' returns JSON 500 on a rejected query instead of an unhandled rejection', async () => {
    const app = load(file, () => { throw Object.assign(Error('PRIVATE_DB_DETAIL'),{code:'TEST_DB_ERROR'}); });
    const res = { status(n){this.code=n;return this;},json(body){this.body=body;return this;} };
    await app.handlers.get('get '+path)({query:{[key]:'910001'}},res);
    assert.equal(res.code,500);assert.equal(typeof res.body.error,'string');
    assert.ok(!JSON.stringify(res.body).includes('PRIVATE_DB_DETAIL'));assert.equal(app.errors.length,1);
  });
}
