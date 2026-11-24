"""离线验证联网源的识别、同比、空响应及成品启动入口。"""
import datetime as dt
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import launcher


class DataFeeds(unittest.TestCase):
    def test_parse_verified_report_month(self):
        districts = sorted(launcher.DISTRICTS)[:5]
        rows = ''.join(f'<tr><td>{i}</td><td>{d}</td><td>62.90</td></tr>' for i, d in enumerate(districts))
        page = '<p>2026年10月，深圳房租为65.01元</p><table><tr><th>排名</th><th>地区</th><th>元/平方米·月</th></tr>' + rows + '</table>'
        with patch.object(launcher, 'request_source', return_value=page):
            self.assertEqual(launcher.report_month('2026-10'), dict.fromkeys(districts,62.9))
            with self.assertRaises(ValueError): launcher.report_month('2026-09')

    def test_correct_year_when_falling_back(self):
        observed = {'2026-09':{'南山区':90},'2025-09':{'南山区':100}}
        def report(month):
            if month not in observed: raise ValueError('月份缺失')
            return observed[month]
        with patch.object(launcher,'now',return_value=dt.datetime(2026,11,23)), patch.object(launcher,'report_month',side_effect=report):
            output = launcher.latest_report()
        self.assertEqual((output['month'],output['prior']),('2026-09','2025-09'))
        self.assertEqual(output['rows']['南山区']['yoy'],-10)

    def test_market_source_requires_place_match(self):
        row={'url':'https://sz.zf.58.com/zujin/test/','name':'新安'}
        info={'other':{'sqInfo':{'localName':'新安'}},'rentTrend':{'1':{'list':[
            {'data_year':'2026','data_month':m,'price':1000,'month_year_rate':-.125} for m in ['09','10']]}}}
        with patch.object(launcher,'now',return_value=dt.datetime(2026,11,23)), patch.object(launcher,'request_source',return_value='window.SSR_DATA='+json.dumps(info)):
            self.assertEqual(launcher.market_report(row)['months']['2026-10']['1']['yoy'],-12.5)
            with self.assertRaises(ValueError): launcher.market_report({**row,'name':'西丽'})
        with patch.object(launcher,'request_source',return_value='<title>验证</title>'):
            with self.assertRaises(ValueError): launcher.market_report(row)

    def test_map_and_amap_have_predictable_fallback(self):
        page=(ROOT/'index.html').read_text(encoding='utf-8')
        nodes=launcher.route_locations(page)
        self.assertIn('企鹅岛',nodes)
        self.assertEqual(len(nodes),382)
        self.assertEqual(launcher.adjacent_map(ROOT),ROOT/'index.html')
        with patch.dict(launcher.os.environ,{'AMAP_WEB_KEY':''}):
            with self.assertRaisesRegex(ValueError,'AMAP_WEB_KEY'): launcher.drive(nodes,'西丽','新安')


if __name__ == '__main__':
    unittest.main()
