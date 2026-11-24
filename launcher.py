# -*- coding: utf-8 -*-
"""深圳租房地图联网版。Python 3.8+，仅用标准库。与地图 HTML 放在同一个目录。
运行 python launcher.py。选用高德 Web 服务时，在本机环境变量 AMAP_WEB_KEY 中设置 Key。
"""
import argparse
import datetime as dt
import html
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

CST = dt.timezone(dt.timedelta(hours=8))
DISTRICTS = set("南山区 福田区 罗湖区 宝安区 龙华区 盐田区 龙岗区 光明区 坪山区 大鹏新区".split())
REPORT = "https://www.creprice.cn/report/sz/"
LOCK = threading.Lock()
CACHE = {}


def now():
    return dt.datetime.now(CST)


def request_source(url):
    request = urllib.request.Request(url, headers={"User-Agent": "ShenzhenRentalAtlas/1.0", "Accept": "text/html,application/json"})
    with urllib.request.urlopen(request, timeout=8) as response:
        if urllib.parse.urlsplit(response.geturl()).hostname != urllib.parse.urlsplit(url).hostname:
            raise ValueError("来源要求跳转或验证，请打开原文核对。")
        raw = response.read(4000001)
        if len(raw) > 4000000:
            raise ValueError("来源页面超出读取范围。")
        return raw.decode(response.headers.get_content_charset() or "utf-8", errors="replace")


class TableReader(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables = []
        self.table = self.row = self.cell = None

    def handle_starttag(self, tag, attrs):
        if tag == 'table':
            self.table = []
        elif tag == 'tr' and self.table is not None:
            self.row = []
        elif tag in ('th', 'td') and self.row is not None:
            self.cell = []

    def handle_data(self, text):
        if self.cell is not None:
            self.cell.append(text)

    def handle_endtag(self, tag):
        if tag in ('th', 'td') and self.cell is not None:
            self.row.append(''.join(self.cell).strip())
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.table.append(self.row)
            self.row = None
        elif tag == 'table' and self.table is not None:
            self.tables.append(self.table)
            self.table = None


def report_month(month):
    year, month_no = map(int, month.split('-'))
    page = request_source(REPORT + month + '.html')
    summary = re.sub('<[^>]+>', ' ', page)
    if not re.search(r'%s年%s月[，,]\s*深圳房租为\s*\d' % (year, month_no), summary):
        raise ValueError("该期住宅租金月报尚未核验。")
    parser = TableReader()
    parser.feed(page)
    for table in parser.tables:
        if not table or not any("月" in c and ("㎡" in c or "平方米" in c) for c in table[0]):
            continue
        rows = {r[1]: float(r[2]) for r in table[1:] if len(r)>=3 and r[1] in DISTRICTS and re.fullmatch(r'\d+(?:\.\d+)?', r[2]) and 0 < float(r[2]) < 1000}
        if len(rows) >= 5:
            return rows
    raise ValueError("该期分区租金表缺失或格式已变化。")


def latest_report():
    last = now().date().replace(day=1) - dt.timedelta(days=1)
    for _ in range(3):
        month = last.strftime('%Y-%m')
        try:
            rents = report_month(month)
            break
        except (ValueError, OSError):
            last = last.replace(day=1) - dt.timedelta(days=1)
    else:
        raise ValueError("暂时无法核验最近三期分区租金月报，保留已存数据。")
    prior = '%04d-%02d' % (last.year-1,last.month)
    try:
        older = report_month(prior)
    except (ValueError, OSError):
        older = {}
    return {"month":month,"prior":prior,"url":REPORT+month+'.html',"priorUrl":REPORT+prior+'.html',
            "rows":{k:{"price":v, "prior":older.get(k),"yoy":round((v/older[k]-1)*100,2) if k in older else None} for k,v in rents.items()}}


def finite(val):
    try:
        n=float(val)
    except (ValueError, TypeError):
        return None
    return n if math.isfinite(n) else None


def market_report(row):
    page=request_source(row["url"])
    match=re.search(r'(?:window\.)?SSR_DATA\s*=\s*',page)
    if not match:
        raise ValueError("来源未返回可核验行情，可能需要人工验证。已保留快照，可打开原文。")
    data=json.JSONDecoder().raw_decode(page[match.end():].lstrip())[0]
    loc=data.get('other',{}).get('sqInfo',{}).get('localName')
    if loc != row['name']:
        raise ValueError("来源地区与所选商圈不一致，已保留快照。")
    months={}
    upper=now().strftime('%Y-%m')
    for room in map(str, range(1,6)):
        for obs in data.get('rentTrend',{}).get(room,{}).get('list',[]):
            year=re.fullmatch(r'(20\d\d)年?',str(obs.get('data_year')))
            month=re.fullmatch(r'(\d{1,2})月?',str(obs.get('data_month')))
            if not year or not month or not 1<=int(month[1])<=12:
                continue
            ym=year[1]+'-'+month[1].zfill(2)
            price=finite(obs.get('price'))
            if not price or not 50<=price<=1000000 or ym>upper:
                continue
            yoy=finite(obs.get('month_year_rate'))
            months.setdefault(ym,{})[room]={'price':price,'yoy':round(yoy*100,2) if yoy is not None else None}
    if len(months)<2:
        raise ValueError("来源返回的有效租金少于两个月份，已保留快照。")
    return {'months':months,'name':loc,'url':row['url']}


def drive(stations,start,end):
    if start not in stations or end not in stations:
        raise ValueError("起终点不在地图中。")
    key=os.environ.get("AMAP_WEB_KEY","").strip()
    if not key:
        raise ValueError("本机尚未设置 AMAP_WEB_KEY。可点高德导航核对当前路线。")
    if start==end:
        return {'seconds':0,'meters':0,'traffic':{}}
    query=urllib.parse.urlencode({'key':key,'origin':','.join(map(str,stations[start])),'destination':','.join(map(str,stations[end])),'strategy':'32','show_fields':'cost,tmcs','output':'json'})
    data=json.loads(request_source('https://restapi.amap.com/v5/direction/driving?'+query))
    if str(data.get('status'))!='1':
        raise ValueError("高德接口暂不可用或未授权（"+str(data.get('infocode','未知'))[:12]+"）。")
    path=data['route']['paths'][0]
    dur=finite(path.get('cost',{}).get('duration'))
    dist=finite(path.get('distance'))
    if dur is None or dist is None or min(dur,dist)<0:
        raise ValueError("高德未返回有效的路线时长。")
    traffic={}
    for step in path.get('steps',[]):
        for group in (step.get('tmcs') or []):
            if not isinstance(group,dict):continue
            status=group.get('tmc_status',group.get('status','未知'))
            if status in ('畅通','缓行','拥堵','严重拥堵','未知'):
                traffic[status]=traffic.get(status,0)+int(finite(group.get('tmc_distance',group.get('distance'))) or 0)
    return {'seconds':dur,'meters':dist,'traffic':traffic}


def script_data(page,element):
    match=re.search(r'<script[^>]*\b(?:id|class)="'+re.escape(element)+r'"[^>]*>(.*?)</script>',page,re.S)
    if not match:
        raise ValueError("找不到地图内嵌数据。")
    return json.loads(match[1])


def route_locations(page):
    stations = {r[0]: r[3] for r in script_data(page, 'szdata')['stations']}
    for node in script_data(page, 'journey-data')['nodes']:
        pt = node.get('coord')
        name = node.get('name')
        if not isinstance(name, str) or not name or not isinstance(pt, list) or len(pt) != 2:
            continue
        lng, lat = (finite(value) for value in pt)
        if lng is not None and lat is not None and -180 <= lng <= 180 and -90 <= lat <= 90:
            stations[name] = [lng, lat]
    return stations


def adjacent_map(folder):
    files = []
    for path in folder.glob('*.html'):
        try:
            body = path.read_text(encoding='utf-8')
        except (OSError, UnicodeDecodeError):
            continue
        if 'id="fine-data"' in body and 'id="journey-data"' in body:
            files.append(path)
    return files[0] if len(files) == 1 else None


def open_map(mapfile,port,launch):
    page=mapfile.read_text(encoding='utf-8')
    atlas=script_data(page,'fine-data')
    allowed={str(i):r for i,r in enumerate(atlas['markets']) if re.fullmatch(r'https://sz\.zf\.58\.com/zujin/[a-z0-9_-]+/?',r['url'])}
    stations=route_locations(page)

    class LocalHandler(BaseHTTPRequestHandler):
        def log_message(self,*args):
            return

        def reply(self,code,body,mime):
            self.send_response(code)
            self.send_header('Content-Type',mime)
            self.send_header('Content-Length',str(len(body)))
            self.send_header('Cache-Control','no-store')
            self.send_header('X-Content-Type-Options','nosniff')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            expected='127.0.0.1:'+str(self.server.server_port)
            if self.headers.get('Host')!=expected or self.headers.get('Sec-Fetch-Site')=='cross-site' or self.headers.get('Origin') not in (None,'http://'+expected):
                return self.reply(403,b'Forbidden','text/plain')
            url=urllib.parse.urlsplit(self.path)
            if url.path in ('/','/index.html'):
                return self.reply(200,page.encode(),'text/html; charset=utf-8')
            if url.path=='/favicon.ico':
                return self.reply(204,b'','image/x-icon')
            params=urllib.parse.parse_qs(url.query)
            key=lambda k:params.get(k,[''])[0]
            if url.path=='/api/status':
                payload={'ok':True,'data':{'service':'shenzhen-rent-atlas','hasAmapKey':bool(os.environ.get('AMAP_WEB_KEY','').strip())}}
                return self.reply(200,json.dumps(payload).encode(),'application/json; charset=utf-8')
            if url.path=='/api/districts':
                load=latest_report
                cache_key='districts'
                ttl=3600
            elif url.path=='/api/market' and key('id') in allowed:
                load=lambda:market_report(allowed[key('id')])
                cache_key='market:'+key('id')
                ttl=3600
            elif url.path=='/api/drive':
                load=lambda:drive(stations,key('from'),key('to'))
                cache_key=('drive',key('from'),key('to'))
                ttl=90
            else:
                return self.reply(404,b'Not found','text/plain')
            try:
                with LOCK: hit=CACHE.get(cache_key)
                if hit and time.monotonic()-hit[0]<ttl: value=hit[1]
                else:
                    value=load()
                    value['checkedAt']=now().isoformat(timespec='seconds')
                    with LOCK:CACHE[cache_key]=(time.monotonic(),value)
                body={'ok':True,'data':value}
            except ValueError as e:
                desc=str(e) if re.match(r'^[\u3400-\u9fff]',str(e)) else "来源格式有变，本次未更新。"
                body={'ok':False,'error':desc}
            except (OSError,KeyError,IndexError,TypeError):
                body={'ok':False,'error':'来源暂不可用，本次未更新。'}
            self.reply(200,json.dumps(body,ensure_ascii=False).encode(),'application/json; charset=utf-8')

    server=ThreadingHTTPServer(('127.0.0.1',port),LocalHandler)
    addr='http://127.0.0.1:'+str(server.server_port)+'/'
    print('深圳租房地图 '+addr+'  (Ctrl+C 关闭)',flush=True)
    if launch: threading.Timer(.3,lambda:webbrowser.open(addr)).start()
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('html',nargs='?',type=Path)
    parser.add_argument('--port',type=int,default=8765)
    parser.add_argument('--no-browser',action='store_true')
    config=parser.parse_args()
    base=Path(__file__).resolve().parent
    page=config.html or base/'深圳租房地图.html'
    if config.html is None and not page.is_file():
        page=adjacent_map(base)
    if page is None or not page.is_file():
        parser.exit(1,'请将启动器与一个深圳租房地图 HTML 放在同一目录，或运行 python launcher.py 地图文件名.html。\n')
    try:open_map(page,config.port,not config.no_browser)
    except OSError:
        parser.exit(1,'无法启动，请关闭已运行的地图或使用 --port 指定其他端口。\n')
