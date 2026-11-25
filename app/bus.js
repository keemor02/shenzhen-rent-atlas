const shenzhenBusIndexes = new WeakMap();
// Cumulative distances along the published stop order are a lower bound on road distance.
// They prevent a long express segment from being priced as a short local-service stop.
function busStopMeters(a, b) {
  if (![a[1], a[2], b[1], b[2]].every(Number.isFinite)) return 0;
  const rad = Math.PI / 180;
  const dx = (a[1] - b[1]) * rad * Math.cos((a[2] + b[2]) * rad / 2);
  const dy = (a[2] - b[2]) * rad;
  return 6371000 * Math.hypot(dx, dy);
}
function indexShenzhenBus(data) {
  if (shenzhenBusIndexes.has(data)) return shenzhenBusIndexes.get(data);
  const bus = data.bus;
  const atStop = bus.stops.map(() => []);
  const walks = bus.stops.map(() => []);
  bus.routes.forEach((route, line) => route[2].forEach((stop, order) => atStop[stop].push([line, order])));
  const cumulative = bus.routes.map(([, , stops]) => {
    let meters = 0;
    return stops.map((stop, i) => {
      if (i) meters += busStopMeters(bus.stops[stops[i-1]], bus.stops[stop]);
      return meters;
    });
  });
  for (const [a,b,distance] of bus.transferLinks) {
    walks[a].push([b,distance]); walks[b].push([a,distance]);
  }
  const index = {atStop,walks,cumulative,byName:new Map(data.nodes.map((p,i)=>[p.name,i]))};
  shenzhenBusIndexes.set(data,index);
  return index;
}
function busOptions(data,fromName,toName) {
  const bus=data.bus, idx=indexShenzhenBus(data);
  const a=typeof fromName==='number'?fromName:idx.byName.get(fromName);
  const b=typeof toName==='number'?toName:idx.byName.get(toName);
  const out={direct:null,transfer:null};
  if (a==null || b==null || a===b || !bus.near[a] || !bus.near[b]) return out;
  function makeReach(near,reverse) {
    const res=new Map();
    for (const [home,meters] of near) {
      for (const [line,homePos] of idx.atStop[home]) {
        const [name,,stops]=bus.routes[line];
        for (let pos=homePos+(reverse?-1:1);pos>=0&&pos<stops.length;pos+=reverse?-1:1) {
          const other=stops[pos], hops=Math.abs(pos-homePos);
          if (bus.stops[home][0]===bus.stops[other][0]) continue;
          const rideMeters=Math.round(Math.abs(idx.cumulative[line][pos]-idx.cumulative[line][homePos]));
          const estimatedRide=Math.max(hops*2.3,rideMeters/(40000/60));
          const option={line,name,board: reverse?other:home,alight:reverse?home:other,hops,meters,rideMeters,estimatedRide,
            score:meters+estimatedRide*60+(name.startsWith('高')?1200:0)};
          let old=res.get(other);
          if (!old) {res.set(other,[option]);continue;}
          const same=old.findIndex(r=>r.name===name);
          if (same>=0) {if(old[same].score<=option.score)continue;old.splice(same,1);}
          old.push(option);old.sort((p,q)=>p.score-q.score);
          if(old.length>2)old.pop();
        }
      }
    }
    return res;
  }
  const forward=makeReach(bus.near[a],false);
  let dirScore=Infinity,trScore=Infinity;
  const asLeg=o=>({line:o.name,towards:bus.routes[o.line][1],fromStop:bus.stops[o.board][0],toStop:bus.stops[o.alight][0],stops:o.hops,
    rideMeters:o.rideMeters,estimatedRide:o.estimatedRide});
  for (const [stop,meters] of bus.near[b]) {
    for (const opt of forward.get(stop)||[]) {
      const score=opt.score+meters;
      if (score>=dirScore)continue;
      dirScore=score;
      out.direct={legs:[asLeg(opt)],stops:opt.hops,rideMeters:opt.rideMeters,estimatedRide:opt.estimatedRide,
        fromMeters:opt.meters,toMeters:meters,transferMeters:0,period:bus.period};
    }
  }
  const reverse=makeReach(bus.near[b],true);
  function join(legA,to,meters) {
    for(const legB of reverse.get(to)||[]) {
      if(legA.name===legB.name)continue;
      const score=legA.score+legB.score+meters;
      if (score>=trScore)continue;
      trScore=score;
      out.transfer={legs:[asLeg(legA),asLeg(legB)],stops:legA.hops+legB.hops,rideMeters:legA.rideMeters+legB.rideMeters,
        estimatedRide:legA.estimatedRide+legB.estimatedRide,fromMeters:legA.meters,toMeters:legB.meters,transferMeters:meters,period:bus.period};
    }
  }
  for(const [stop,opts] of forward) for (const opt of opts) {
    join(opt,stop,0);
    for (const [other,meters] of idx.walks[stop]) join(opt,other,meters);
  }
  for (const s of bus.publishedShuttles.shuttles) {
    const from=data.nodes[a].name,to=data.nodes[b].name;
    const outgoing=s.from===from&&s.to===to, returning=s.bidirectional&&s.to===from&&s.from===to;
    if(!outgoing&&!returning)continue;
    const stop1=outgoing?s.fromStop:s.toStop, stop2=outgoing?s.toStop:s.fromStop;
    out.direct={legs:[{line:s.line,towards:stop2,fromStop:stop1,toStop:stop2,stops:s.stops}],stops:s.stops,fromMeters:null,toMeters:null,transferMeters:0,period:bus.publishedShuttles.date,shuttle:true};
  }
  return out;
}
