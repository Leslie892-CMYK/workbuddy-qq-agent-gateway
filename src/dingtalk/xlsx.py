#!/usr/bin/env python3
"""Read an uploaded XLSX with only the Python standard library."""
import io
import json
import re
import sys
import zipfile
from datetime import datetime, timedelta
from xml.etree import ElementTree as ET

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "p": "http://schemas.openxmlformats.org/package/2006/relationships"}

def text(node):
    return "".join(child.text or "" for child in node.findall(".//m:t", NS))

def column(ref):
    letters = re.match(r"[A-Z]+", ref or "")
    n = 0
    for letter in letters.group(0) if letters else "":
        n = n * 26 + ord(letter) - 64
    return n - 1

def main(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as book:
        if sum(item.file_size for item in book.infolist()) > 40 * 1024 * 1024:
            raise ValueError("工作簿解压后超过 40 MiB")
        names = set(book.namelist())
        if "xl/workbook.xml" not in names:
            raise ValueError("不是有效的 XLSX 工作簿")
        shared = []
        if "xl/sharedStrings.xml" in names:
            root = ET.fromstring(book.read("xl/sharedStrings.xml"))
            shared = [text(si) for si in root.findall("m:si", NS)]
        date_styles = {}
        if "xl/styles.xml" in names:
            styles = ET.fromstring(book.read("xl/styles.xml"))
            formats = {int(fmt.attrib["numFmtId"]): fmt.attrib.get("formatCode", "")
                       for fmt in styles.findall("m:numFmts/m:numFmt", NS)}
            for i, xf in enumerate(styles.findall("m:cellXfs/m:xf", NS)):
                number = int(xf.attrib.get("numFmtId", "0"))
                pattern = formats.get(number, "")
                if 14 <= number <= 22 or re.search(r"[ymdhHsS]", pattern):
                    date_styles[i] = "time" if (number in (18, 19, 20, 21) or
                        re.search(r"[hH]", pattern) and not re.search(r"[yYdD]", pattern)) else "date"
        workbook = ET.fromstring(book.read("xl/workbook.xml"))
        rels = ET.fromstring(book.read("xl/_rels/workbook.xml.rels"))
        targets = {rel.attrib["Id"]: rel.attrib["Target"] for rel in rels}
        sheets = workbook.findall("m:sheets/m:sheet", NS)
        sheet = next((s for s in sheets if s.attrib.get("name") == "全部"), sheets[0] if sheets else None)
        if sheet is None:
            raise ValueError("工作簿没有工作表")
        relation = sheet.attrib.get("{%s}id" % NS["r"])
        target = targets.get(relation, "")
        filename = target.lstrip("/") if target.startswith("/") else "xl/" + target
        filename = filename.replace("xl/xl/", "xl/")
        if filename not in names or not filename.startswith("xl/worksheets/"):
            raise ValueError("找不到工作表数据")
        root = ET.fromstring(book.read(filename))
        rows = []
        for row in root.findall("m:sheetData/m:row", NS)[:2001]:
            cells = {}
            for cell in row.findall("m:c", NS):
                index = column(cell.attrib.get("r"))
                if index < 0 or index > 100:
                    continue
                kind = cell.attrib.get("t")
                value = cell.find("m:v", NS)
                if kind == "inlineStr":
                    result = text(cell.find("m:is", NS))
                elif kind == "s" and value is not None:
                    result = shared[int(value.text)]
                else:
                    result = value.text if value is not None else ""
                    style = date_styles.get(int(cell.attrib.get("s", "0")))
                    if style and result:
                        try:
                            parsed = datetime(1899, 12, 30) + timedelta(days=float(result))
                            result = parsed.strftime("%H:%M") if style == "time" else parsed.strftime("%Y-%m-%d")
                        except ValueError:
                            pass
                cells[index] = result or ""
            if cells:
                rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
        if not rows:
            raise ValueError("工作表是空的")
        return {"sheet": sheet.attrib.get("name"), "rows": rows, "truncated": len(rows) > 2000}

if __name__ == "__main__":
    try:
        print(json.dumps(main(sys.stdin.buffer.read()), ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        sys.exit(1)
