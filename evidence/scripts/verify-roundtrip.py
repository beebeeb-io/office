#!/usr/bin/env python3
"""Task 1567 goal 2 — confirm a marker string round-tripped through a saved
.docx/.xlsx/.pptx WITHOUT using LibreOffice itself (independent verification,
per the brief: "re-open the saved file headless with ... python-docx/openpyxl").

Usage: verify-roundtrip.py <file.docx|xlsx|pptx> <marker-string>
Exits 0 and prints FOUND if the marker text is present anywhere readable in the
file; exits 1 and prints NOT_FOUND otherwise. Exits 2 on a file that fails to
parse at all (corrupt save).
"""
import sys


def check_docx(path, marker):
    from docx import Document

    doc = Document(path)
    text = "\n".join(p.text for p in doc.paragraphs)
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                text += "\n" + cell.text
    return marker in text


def check_xlsx(path, marker):
    from openpyxl import load_workbook

    wb = load_workbook(path, data_only=True)
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if cell.value is not None and marker in str(cell.value):
                    return True
    return False


def check_pptx(path, marker):
    from pptx import Presentation

    pres = Presentation(path)
    for slide in pres.slides:
        for shape in slide.shapes:
            if shape.has_text_frame and marker in shape.text_frame.text:
                return True
    return False


def main():
    if len(sys.argv) != 3:
        print("usage: verify-roundtrip.py <file> <marker>", file=sys.stderr)
        return 2
    path, marker = sys.argv[1], sys.argv[2]
    ext = path.rsplit(".", 1)[-1].lower()
    checkers = {"docx": check_docx, "xlsx": check_xlsx, "pptx": check_pptx}
    if ext not in checkers:
        print(f"unsupported extension: {ext}", file=sys.stderr)
        return 2
    try:
        found = checkers[ext](path, marker)
    except Exception as e:  # noqa: BLE001 - this IS the corruption check
        print(f"PARSE_ERROR: {e}")
        return 2
    print("FOUND" if found else "NOT_FOUND")
    return 0 if found else 1


if __name__ == "__main__":
    sys.exit(main())
