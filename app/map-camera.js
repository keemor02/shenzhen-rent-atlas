/* Geographic coordinates stay in the atlas projection as the viewport changes. */
function atlasExtent(boxes) {
  return boxes.reduce((a,b)=>[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[2],b[2]),Math.max(a[3],b[3])], [Infinity,Infinity,-Infinity,-Infinity]);
}

function makeMapCamera(svg, world, repaint, enabled=()=>true, fastTransform=null) {
  let cx, cy, zoom, frame=0, settleTimer=0, dragged=false, blockClick=false;
  let initial=null, lastTapTime=0, lastTapPt=null, cachedRect=null;
  const pointers=new Map();
  const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const invalidateRect=()=>{ cachedRect=null; };
  function getRect() {
    if (!cachedRect) {
      const r=svg.getBoundingClientRect();
      cachedRect={ width:r.width||740, height:r.height||420, left:r.left||0, top:r.top||0 };
    }
    return cachedRect;
  }
  if (typeof window!=='undefined' && window.addEventListener) window.addEventListener('resize', invalidateRect);
  if (typeof ResizeObserver==='function' && svg && typeof svg.nodeType==='number') {
    try { new ResizeObserver(invalidateRect).observe(svg); } catch {}
  }
  function viewport() {
    const rect=getRect();
    const w=rect.width||740, h=rect.height||420;
    const unit=Math.min((w-28)/(world[2]-world[0]),(h-28)/(world[3]-world[1]));
    const k=unit*zoom, tx=w/2-cx*k, ty=h/2-cy*k;
    return {w,h,k,tx,ty,pt:p=>[p[0]*k+tx,p[1]*k+ty],worldAt:p=>[(p[0]-tx)/k,(p[1]-ty)/k]};
  }
  function fit(box=world, opt={}) {
    invalidateRect();
    const padB=Math.max(0, Number(opt?.padBottom)||0);
    cx=(box[0]+box[2])/2;cy=(box[1]+box[3])/2;zoom=1;
    const {k,w,h}=viewport();
    const availH=Math.max(120, h-28-padB);
    zoom=clamp(Math.min((w-28)/Math.max(18,box[2]-box[0]),availH/Math.max(16,box[3]-box[1]))/k,1,42);
    if(padB>0){
      const k2=viewport().k;
      cy=clamp(cy+(padB/2)/k2, world[1], world[3]);
    }
  }
  function flushSettle() {
    if(settleTimer){clearTimeout(settleTimer);settleTimer=0;}
  }
  function redraw(interactive=false) {
    if(!interactive){
      flushSettle();
      if(frame){if(typeof cancelAnimationFrame==='function')cancelAnimationFrame(frame);frame=0;}
      frame=requestAnimationFrame(()=>{frame=0;svg.classList?.remove?.('panning');if(enabled())repaint();});
      return;
    }
    if(!frame)frame=requestAnimationFrame(()=>{
      frame=0;
      if(!enabled())return;
      if(typeof fastTransform==='function'&&fastTransform(viewport())){
        flushSettle();
        settleTimer=setTimeout(()=>{settleTimer=0;if(!dragged)svg.classList?.remove?.('panning');if(enabled())repaint();},150);
        return;
      }
      flushSettle();
      if(!dragged)svg.classList?.remove?.('panning');
      repaint();
    });
  }
  function anchor(point,oldWorld,factor) {
    const baseScale=viewport().k/zoom;
    zoom=clamp(zoom*factor,.75,Math.max(42,400/baseScale));
    const {k,w,h}=viewport();
    cx=clamp(oldWorld[0]-(point[0]-w/2)/k,world[0],world[2]);
    cy=clamp(oldWorld[1]-(point[1]-h/2)/k,world[1],world[3]);
  }
  const local=e=>{const r=getRect();return [e.clientX-r.left,e.clientY-r.top];};
  function move(factor=1,dx=0,dy=0,at,interactive=false) {
    const v=viewport(),p=at||[v.w/2,v.h/2];
    anchor([p[0]+dx,p[1]+dy],v.worldAt(p),factor);redraw(interactive);
  }
  function control(key) {
    if(key==='reset'){fit(world);redraw();}
    else move(key==='in'?1.5:1/1.5);
  }
  function gesture() {
    const [a,b]=pointers.values();
    return b?{mid:[(a[0]+b[0])/2,(a[1]+b[1])/2],span:Math.max(1,distance(a,b))}:{mid:a,span:1};
  }
  svg.addEventListener('wheel',e=>{
    if(!enabled()||!e.deltaY)return;
    e.preventDefault();
    const delta=e.deltaY*(e.deltaMode===1?16:e.deltaMode===2?svg.clientHeight:1);
    move(Math.exp(-clamp(delta,-280,280)*.003),0,0,local(e),true);
  },{passive:false});
  svg.addEventListener('pointerdown',e=>{
    if(!enabled()||e.button!==0||pointers.size>=2)return;
    if(!pointers.size){invalidateRect();dragged=false;blockClick=false;}
    pointers.set(e.pointerId,local(e));initial=gesture();
    // Preserve the original hit target for a tap. Capture on the SVG only once dragging.
    if(pointers.size===2){dragged=true;for(const id of pointers.keys())svg.setPointerCapture?.(id);}
  });
  svg.addEventListener('pointermove',e=>{
    if(!pointers.has(e.pointerId))return;
    const from=gesture();pointers.set(e.pointerId,local(e));const to=gesture();
    const thresh=e.pointerType==='touch'?9:5;
    if(!dragged && pointers.size<2 && distance(to.mid,initial.mid)<thresh)return;
    const start=dragged?from:initial;
    dragged=true;svg.setPointerCapture?.(e.pointerId);
    svg.classList.add('panning');
    anchor(to.mid,viewport().worldAt(start.mid),to.span/start.span);redraw(true);
  });
  function end(e) {
    if(!pointers.delete(e.pointerId))return;
    if(pointers.size){initial=gesture();return;}
    const wasDragged=dragged;
    blockClick=dragged;dragged=false;initial=null;svg.classList.remove('panning');
    // Touch double-tap on bare map background zooms in smoothly around finger point
    if(!wasDragged && e.type==='pointerup' && e.pointerType==='touch' && e.target===svg){
      const now=Date.now(), ptNow=local(e);
      if(lastTapPt && now-lastTapTime<320 && distance(ptNow,lastTapPt)<30){
        lastTapTime=0; lastTapPt=null;
        move(1.85,0,0,ptNow,false);
        return;
      }
      lastTapTime=now; lastTapPt=ptNow;
    }
    if(wasDragged){flushSettle();redraw(false);}
  }
  for(const name of ['pointerup','pointercancel'])svg.addEventListener(name,end);
  svg.addEventListener('lostpointercapture',e=>{if(e.target===svg)end(e);});
  svg.addEventListener('pointerleave',e=>{if(!dragged)end(e);});
  svg.addEventListener('click',e=>{
    if(blockClick&&e.detail!==0){e.preventDefault();e.stopImmediatePropagation();blockClick=false;}
  },true);
  svg.addEventListener('keydown',e=>{
    if(!enabled())return;
    const pan={ArrowLeft:[65,0],ArrowRight:[-65,0],ArrowUp:[0,65],ArrowDown:[0,-65]};
    if(pan[e.key])move(1,...pan[e.key]);
    else if(['+','=','-','Home'].includes(e.key))control(e.key==='Home'?'reset':e.key==='-'?'out':'in');
    else return;
    e.preventDefault();
  });
  fit();
  function snapshot(){return {cx,cy,zoom};}
  function restore(view){if(view&&[view.cx,view.cy,view.zoom].every(Number.isFinite)&&view.zoom>0){cx=view.cx;cy=view.cy;zoom=view.zoom;}}
  return {viewport,fit,control,snapshot,restore,reset:()=>fit(world)};
}
