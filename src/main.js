(function startAtlas() {
  'use strict';
  const byId = id => document.getElementById(id);
  const read = el => JSON.parse(el.textContent);
  const base = read(document.querySelector('.szdata')), data = read(byId('fine-data'));
  const travel = read(byId('journey-data')), timing = read(byId('time-data'));
  if (travel?.driving?.packed) {
    const unpackMatrix = (b64, n) => {
      const bin = atob(b64), rows = new Array(n);
      let p = 0;
      for (let i = 0; i < n; i++) {
        const row = new Int32Array(n);
        let prev = 0;
        for (let j = 0; j < n; j++) {
          let z = 0, shift = 0, b;
          do { b = bin.charCodeAt(p++); z |= (b & 127) << shift; shift += 7; } while (b & 128);
          prev += (z & 1) ? -((z + 1) >>> 1) : (z >>> 1);
          row[j] = prev;
        }
        rows[i] = row;
      }
      return rows;
    };
    const pk = travel.driving.packed;
    travel.driving.durations = unpackMatrix(pk.durations, pk.n);
    travel.driving.distances = unpackMatrix(pk.distances, pk.n);
    delete travel.driving.packed;
  }
  let connected=false, onlineKey=false, game, marketFocus=null, districtFeed=null;
  let lastMessage='', running=false;
  const recent=new Map(), pending=new Map(), consumers=new Map();
  const cacheKey='sz-rent-public-feeds-v2', autoKey='sz-rent-autocheck-v1';
  const dataNames=new Set(base.districts.map(d=>d.n));
  const currentMonth=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).format(new Date());
  const initialReportUrl=base.apartment.listing.sources.at(-1);
  const initialPeriod=initialReportUrl.match(/(20\d\d-\d\d)\.html$/)?.[1];
  const initialDistricts=new Map(base.districts.map(d=>[d.n,d]));
  function getLocal(k) {try{return localStorage.getItem(k);}catch{return null;}}
  function putLocal(k,v) {try{localStorage.setItem(k,v);}catch{}}
  function storeFeed() {
    const markets={};consumers.forEach((value,key)=>{markets[key]=value;});
    putLocal(cacheKey,JSON.stringify({districts:districtFeed,markets}));
  }
  const validMonth=s=>typeof s==='string'&&/^20\d\d-(0[1-9]|1[0-2])$/.test(s)&&s<=currentMonth;
  const validNumber=n=>typeof n==='number'&&Number.isFinite(n);
  const validCheck=t=>typeof t==='string'&&Number.isFinite(Date.parse(t));
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=n=>n.toLocaleString('zh-CN',{maximumFractionDigits:2});
  const percent=n=>validNumber(n)?(n>0?'+':'')+fmt(n)+'%':'—';
  const link=(label,href)=>'<a target="_blank" rel="noopener noreferrer" href="'+esc(href)+'">'+esc(label)+'</a>';
  function installDistrict(report) {
    if(!report||!validMonth(report.month)||!validMonth(report.prior)||report.url!=='https://www.creprice.cn/report/sz/'+report.month+'.html'||!validCheck(report.checkedAt))return false;
    if(initialPeriod&&report.month<initialPeriod)return false;
    if(report.prior!==String(Number(report.month.slice(0,4))-1)+report.month.slice(4))return false;
    const rows={};
    for(const [name,r] of Object.entries(report.rows||{})){
      if(!dataNames.has(name)||!validNumber(r?.price)||r.price<=0)continue;
      const savedPrior=(districtFeed?.month===report.month?districtFeed.rows[name]?.prior:null)
        ??(initialPeriod===report.month?initialDistricts.get(name)?.oct2025:null);
      const prior=validNumber(r.prior)&&r.prior>0?r.prior:savedPrior;
      const yoy=validNumber(r.yoy)?r.yoy:validNumber(prior)&&prior>0?Math.round((r.price/prior-1)*10000)/100:null;
      rows[name]={price:r.price,yoy,prior:validNumber(prior)?prior:null};
    }
    if(Object.keys(rows).length<5 || (districtFeed && districtFeed.month>report.month))return false;
    districtFeed={month:report.month,prior:report.prior,url:report.url,checkedAt:report.checkedAt,rows};
    game?.updateDistricts?.(districtFeed);
    return true;
  }
  function installMarket(mid,report,fromCache=false) {
    const market=data.markets[mid];
    if(!market||report?.name!==market.name||report.url!==market.url||!validCheck(report.checkedAt))return false;
    const previous=consumers.get(market.url);
    const months={};
    for(const [period,values] of Object.entries(report.months||{})){
      if(!validMonth(period))continue;
      const rooms={};
      for(const [r,o] of Object.entries(values||{})){
        if(!/^[1-5]$/.test(r)||!validNumber(o?.price)||o.price<=0)continue;
        // Old caches merged multiple fetches under one report timestamp.
        // Only a fresh response or a saved row timestamp can date this room.
        const checkedAt=fromCache?(validCheck(o.checkedAt)?o.checkedAt:null):report.checkedAt;
        rooms[r]={price:o.price,yoy:validNumber(o.yoy)?o.yoy:null,checkedAt};
      }
      if(Object.keys(rooms).length)months[period]=rooms;
    }
    if(!Object.keys(months).length)return false;
    const stored={...previous?.months};
    for(const [month,rooms] of Object.entries(months)){
      market.months[month]={...market.months[month],...rooms};
      stored[month]={...stored[month],...rooms};
    }
    consumers.set(market.url,{name:market.name,url:market.url,months:stored,checkedAt:report.checkedAt});
    return true;
  }
  try {
    const local=JSON.parse(getLocal(cacheKey)||'{}');
    if(local.districts)installDistrict(local.districts);
    data.markets.forEach((m,i)=>{if(local.markets?.[m.url])installMarket(i,local.markets[m.url],true);});
  } catch {}
  const checked=t=>validCheck(t)?new Date(t).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'';
  function drawUpdates() {
    const status=byId('live-connection');
    status.textContent=connected?'本机联网服务已连接。'+(onlineKey?'已配置高德路线服务。':'实时驾车可在配置高德 Key 后使用。'):'当前使用内置或本机已存数据。要读取新月报、查询实时路况，可使用联网启动器。';
    byId('live-auto-label').hidden=!connected;
    byId('live-sync').textContent=running?'正在检查…':connected?'检查最新租金':'查看联网启用方法';
    byId('live-sync').disabled=running;
    byId('live-result').textContent=lastMessage;
    let info='';
    if(marketFocus!=null){
      const m=data.markets[marketFocus];
      if(m){const loaded=consumers.get(m.url);
        info+='<p>'+esc(m.name)+'商圈 · '+(loaded?'最近核验 '+esc(checked(loaded.checkedAt)):'内置月报')+' · '+link('分户型来源',m.url)+'</p>';
      }
    }
    if(districtFeed){
      const d=districtFeed,rows=Object.entries(d.rows).sort(([,a],[,b])=>b.price-a.price);
      info+='<details><summary>'+esc(d.month)+' 各区住宅挂牌均价 · '+rows.length+' 区</summary><p>单位为元/㎡·月，同比对照 '+esc(d.prior)+'。租金行情另有按原期保留的小区、集中式公寓等指标。</p><table style="border-collapse:separate;border-spacing:10px 2px;text-align:right"><thead><tr><th>分区</th><th>挂牌均价</th><th>同比</th></tr></thead><tbody>'+rows.map(([n,r])=>'<tr><td>'+esc(n)+'</td><td>'+fmt(r.price)+'</td><td>'+percent(r.yoy)+'</td></tr>').join('')+'</tbody></table><p>'+link('当期月报',d.url)+' · '+link('上年同期','https://www.creprice.cn/report/sz/'+d.prior+'.html')+' · 核验 '+esc(checked(d.checkedAt))+'</p></details>';
    }
    byId('live-reports').innerHTML=info;
  }
  async function api(path,timeout=40000) {
    const control=new AbortController(),timer=setTimeout(()=>control.abort(),timeout);
    try {
      const response=await fetch(path,{cache:'no-store',signal:control.signal,headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error('本机服务返回 '+response.status+'，请确认联网启动器仍在运行。');
      let packet;
      try{packet=await response.json();}catch{throw new Error('未收到联网服务的数据，请用下载的启动器打开地图。');}
      if(!packet?.ok)throw new Error(packet?.error||'源站暂未返回可核验的数据。');
      return packet.data;
    }catch(e){
      if(e.name==='AbortError')throw new Error('本次在线查询超时，可稍后重试。');
      if(e instanceof TypeError)throw new Error('无法连接本机联网服务，请检查启动器窗口。');
      throw e;
    }finally{clearTimeout(timer);}
  }
  function refreshVisible() {
    game?.refresh();drawUpdates();
  }
  function once(key,load,manual) {
    if(pending.has(key))return pending.get(key);
    if(!manual&&Date.now()-(recent.get(key)||0)<3600000)return Promise.resolve(null);
    const job=load().then(result=>{recent.set(key,Date.now());return result;})
      .finally(()=>pending.delete(key));
    pending.set(key,job);return job;
  }
  async function ensureMarket(mid,manual=false) {
    if(mid==null||!data.markets[mid])return null;
    marketFocus=mid;drawUpdates();
    if(!connected||(!manual&&!byId('live-auto').checked))return null;
    try{
      return await once('market:'+mid,async()=>{
        const r=await api('/api/market?id='+encodeURIComponent(mid));
        if(!installMarket(mid,r))throw new Error('来源数据与所选商圈或月份不一致。');
        storeFeed();refreshVisible();return r;
      },manual);
    }catch(e){
      if(manual)throw e;
      if(marketFocus===mid)lastMessage=data.markets[mid].name+'商圈此次未更新。'+e.message;
      drawUpdates();return null;
    }
  }
  async function sync(manual=false) {
    if(!connected){if(manual){byId('launch-help').open=true;lastMessage='先下载启动器，并按照下方说明打开地图。';drawUpdates();}return;}
    if(running)return;running=true;drawUpdates();
    const result=[], active=marketFocus;
    const jobs=[['分区月报',once('districts',async()=>{
      const r=await api('/api/districts');
      if(!installDistrict(r))throw new Error('未获得可核验的新一期分区表。');
      storeFeed();return r;
    },manual)]];
    if(active!=null)jobs.push([data.markets[active].name+'商圈',ensureMarket(active,manual)]);
    const completed=await Promise.allSettled(jobs.map(x=>x[1]));
    completed.forEach((r,i)=>{
      if(r.status==='rejected')result.push(jobs[i][0]+'未更新。'+(r.reason?.message||'来源暂不可用。'));
      else if(r.value)result.push(jobs[i][0]+'已核验');
    });
    if(result.length)lastMessage=result.join('　');
    running=false;refreshVisible();
  }
  async function liveDrive(from,to) {
    if(!connected)throw new Error('实时驾车需要联网启动器和本机高德 Web 服务 Key。可打开高德导航查看当前路线。');
    if(!onlineKey)throw new Error('本机尚未设置 AMAP_WEB_KEY。设置后重启联网启动器，即可查询实时驾车。');
    const r=await api('/api/drive?'+new URLSearchParams({from,to}),16000);
    if(!validNumber(r?.seconds)||r.seconds<0||!validNumber(r?.meters)||r.meters<0)throw new Error('高德未返回有效的路线时长。');
    return {minutes:Math.ceil(r.seconds/60),seconds:r.seconds,meters:r.meters,traffic:r.traffic||{},checkedAt:r.checkedAt};
  }
  function focusMarket(mid) {
    if(mid===marketFocus)return;
    marketFocus=mid??null;
    if(mid!=null)ensureMarket(mid);else drawUpdates();
  }
  const facilities=read(byId('facilities-data')),policies=read(byId('policy-data'));
  game=window.initGame({data,base,travel,timing,facilities,policies,liveDrive,ensureMarket,focusMarket,districtFeed});
  byId('live-auto').checked=getLocal(autoKey)!=='false';
  byId('live-auto').addEventListener('change',event=>{putLocal(autoKey,String(event.target.checked));if(event.target.checked)sync();});
  byId('live-sync').addEventListener('click',()=>sync(true));
  byId('download-launcher').addEventListener('click',()=>{
    const raw=byId('launcher-source')?.textContent||'';let python=raw;
    try{const value=JSON.parse(raw);if(typeof value==='string')python=value;}catch{}
    if(!python.trim()){lastMessage='当前文件没有嵌入启动器。';drawUpdates();return;}
    const blob=URL.createObjectURL(new Blob([python],{type:'text/x-python;charset=utf-8'}));
    const a=document.createElement('a');a.href=blob;a.download='launcher.py';document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(blob),2000);byId('launch-help').open=true;
  });
  game.show();
  drawUpdates();
  const onLocalServer=location.protocol==='http:'&&location.hostname==='127.0.0.1';
  if(onLocalServer)api('/api/status',4000).then(s=>{
    if(s?.service!=='shenzhen-rent-atlas')return;
    connected=true;onlineKey=s.hasAmapKey===true;drawUpdates();
    if(byId('live-auto').checked)sync();
    setInterval(()=>{if(!document.hidden&&byId('live-auto').checked)sync();},3600000);
  }).catch(()=>drawUpdates());
})();
