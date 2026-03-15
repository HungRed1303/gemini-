import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const column = ((form.get("column") as string) || "A").toUpperCase();

    if (!file) return NextResponse.json({ error: "Thiếu file" }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const wb = XLSX.read(bytes, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1 }) as string[][];

    const colIndex = column.charCodeAt(0) - 65; // A=0, B=1 ...
    const paths: string[] = [];

    for (let i = 1; i < rows.length; i++) {
      const val = rows[i]?.[colIndex];
      if (val && String(val).trim()) {
        paths.push(String(val).trim());
      }
    }

    return NextResponse.json({ paths, total: paths.length });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
