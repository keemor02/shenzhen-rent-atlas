const { test }=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const page=fs.readFileSync(path.join(__dirname,'..','开始审查.html'),'utf8');
const script=page.match(/<script>([\s\S]+?)<\/script>/)[1];

function launch(location) {
  const nodes={folder:{},open:{hidden:true},prompt:{textContent:'读取 REVIEW.md，审查地图'},copy:{}};
  const context={location:new URL(location),URL,document:{getElementById:id=>nodes[id]}};
  vm.runInNewContext(script,context);
  return nodes;
}

test('the handoff opens the actual Windows project folder with a prepared review prompt',()=>{
  const nodes=launch('file:///C:/Users/example/Projects/%E6%B7%B1%E5%9C%B3%20%E7%A7%9F%E6%88%BF/开始审查.html');
  const url=new URL(nodes.open.href);
  assert.equal(url.protocol,'codex:');
  assert.equal(url.hostname,'new');
  assert.equal(url.searchParams.get('path'),'C:\\Users\\example\\Projects\\深圳 租房');
  assert.equal(url.searchParams.get('prompt'),nodes.prompt.textContent);
  assert.equal(nodes.open.hidden,false);
});

test('handoff supports macOS paths and keeps remote previews from picking a wrong directory',()=>{
  const nodes=launch('file:///Users/example/%E5%9C%B0%E5%9B%BE/开始审查.html');
  assert.equal(new URL(nodes.open.href).searchParams.get('path'),'/Users/example/地图');
  assert.equal(launch('https://example.invalid/开始审查.html').open.hidden,true);
});
