"""从项目内的模板、模块与快照构建单文件地图。仅使用 Python 标准库。"""
import argparse
import base64
import json
from pathlib import Path
import re
import tempfile

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "src/index.template.html"
TOKEN = re.compile(r"\{\{(json:launcher\.py|(?:src|data)/[\w.-]+)\}\}")


def read_text(path):
    return path.read_text(encoding="utf-8")


def pack_int_matrix(matrix):
    buf = bytearray()
    for row in matrix:
        prev = 0
        for val in row:
            diff = val - prev
            prev = val
            z = diff * 2 if diff >= 0 else (-diff) * 2 - 1
            while z >= 128:
                buf.append((z & 127) | 128)
                z >>= 7
            buf.append(z)
    return base64.b64encode(bytes(buf)).decode("ascii")


def pack_journey_json(payload):
    obj = json.loads(payload)
    drv = obj.get("driving") if isinstance(obj, dict) else None
    if (
        isinstance(drv, dict)
        and isinstance(drv.get("durations"), list)
        and isinstance(drv.get("distances"), list)
        and len(drv["durations"]) > 0
        and len(drv["durations"]) == len(drv["distances"])
        and all(isinstance(r, list) and len(r) == len(drv["durations"]) and all(isinstance(v, int) and not isinstance(v, bool) for v in r) for r in drv["durations"])
        and all(isinstance(r, list) and len(r) == len(drv["distances"]) and all(isinstance(v, int) and not isinstance(v, bool) for v in r) for r in drv["distances"])
    ):
        drv["packed"] = {
            "n": len(drv["durations"]),
            "durations": pack_int_matrix(drv["durations"]),
            "distances": pack_int_matrix(drv["distances"]),
        }
        del drv["durations"]
        del drv["distances"]
        return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    return payload.strip()


def render_template(path, parents=()):
    if path in parents:
        raise ValueError(f"模板发生循环引用 {path.name}")

    def include(match):
        name = match.group(1)
        if name == "json:launcher.py":
            encoded = json.dumps(read_text(ROOT / "launcher.py"), ensure_ascii=False)
            return encoded.replace("<", r"\u003c")

        part = ROOT / name
        if part.suffix == ".html":
            return render_template(part, (*parents, path))
        payload = read_text(part)
        if part.suffix == ".json":
            if name == "data/journey.json":
                return pack_journey_json(payload).replace("<", r"\u003c")
            json.loads(payload)
            return payload.strip().replace("<", r"\u003c")
        if part.suffix == ".js" and "</script" in payload.lower():
            raise ValueError(f"{name} 含有会提前闭合脚本的 HTML 标签")
        return payload

    return TOKEN.sub(include, read_text(path))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="比较成品与源码，不写文件")
    parser.add_argument("--output", type=Path, default=ROOT / "index.html")
    args = parser.parse_args()
    output = args.output.resolve()
    packed = render_template(TEMPLATE).encode("utf-8")
    if args.check:
        if not output.is_file() or output.read_bytes() != packed:
            parser.exit(1, "成品与源码不同，请运行 python tools/build.py。\n")
        print(f"OK {output.name}")
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=output.parent, delete=False) as tmp:
        temporary_path = Path(tmp.name)
        try:
            tmp.write(packed)
        except BaseException:
            tmp.close()
            temporary_path.unlink(missing_ok=True)
            raise
    try:
        temporary_path.replace(output)
    finally:
        temporary_path.unlink(missing_ok=True)
    print(f"{output.name} · {len(packed):,} bytes")


if __name__ == "__main__":
    main()
