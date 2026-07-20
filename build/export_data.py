#!/usr/bin/env python3
# Reads the source workbook and emits deck_data.json for the deck generator.
import json, sys, openpyxl
XLSX = sys.argv[1] if len(sys.argv) > 1 else "Данные — структура и ФОТ.xlsx"
OUT  = sys.argv[2] if len(sys.argv) > 2 else "deck_data.json"
wb = openpyxl.load_workbook(XLSX, data_only=False)
d = wb["Данные"]
data = {}
for r in range(3, d.max_row + 1):
    key = d.cell(r, 10).value
    if not key:
        continue
    data[str(key).strip()] = {
        "label":  (d.cell(r, 5).value or "").strip(),
        "detail": (d.cell(r, 6).value or "").strip(),
        "salary": int(d.cell(r, 7).value or 0),
        "assumed": str(d.cell(r, 8).value or "").strip().lower() in ("макс.", "макс", "да", "true", "1"),
        "vacant":  str(d.cell(r, 9).value or "").strip().lower() in ("да", "yes", "true", "1"),
    }
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=1)
print(f"wrote {OUT}: {len(data)} positions")
