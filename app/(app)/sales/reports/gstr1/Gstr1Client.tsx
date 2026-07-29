"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { FileSpreadsheet, Download, Loader2 } from "lucide-react";
import { getGstr1, type Gstr1Row, type Gstr1Hsn } from "@/app/actions/gst";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

function monthDefaults() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

export default function Gstr1Client() {
  const def = monthDefaults();
  const [from, setFrom] = useState(def.from);
  const [to, setTo] = useState(def.to);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<null | {
    rows: Gstr1Row[];
    hsn: Gstr1Hsn[];
    summary: { count: number; taxable: number; cgst: number; sgst: number; igst: number; total: number };
    company: { name: string; gstin: string };
  }>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const res = await getGstr1(from, to);
    setLoading(false);
    if (!res.success) {
      setError(res.error || "Failed to load");
      setData(null);
      return;
    }
    setData({ rows: res.rows, hsn: res.hsn, summary: res.summary, company: res.company });
  };

  const exportExcel = () => {
    if (!data) return;
    const wb = XLSX.utils.book_new();

    const b2b = data.rows.filter((r) => r.type === "B2B");
    const b2c = data.rows.filter((r) => r.type === "B2C");
    const cols = (rows: Gstr1Row[]) =>
      rows.map((r) => ({
        "GSTIN/UIN": r.gstin,
        "Receiver": r.customerName,
        "Invoice No": r.invoiceNo,
        "Invoice Date": r.invoiceDate,
        "Place of Supply": r.placeOfSupply,
        "Taxable Value": r.taxable,
        "CGST": r.cgst,
        "SGST": r.sgst,
        "IGST": r.igst,
        "Invoice Value": r.total,
      }));

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cols(b2b)), "B2B");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cols(b2c)), "B2C");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(
        data.hsn.map((h) => ({
          HSN: h.hsn,
          "Total Qty": h.qty,
          "Taxable Value": h.taxable,
          CGST: h.cgst,
          SGST: h.sgst,
          IGST: h.igst,
          "Total Value": h.total,
        }))
      ),
      "HSN Summary"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet([
        { Field: "GSTIN", Value: data.company.gstin },
        { Field: "Legal Name", Value: data.company.name },
        { Field: "Period From", Value: from },
        { Field: "Period To", Value: to },
        { Field: "Invoices", Value: data.summary.count },
        { Field: "Taxable Value", Value: data.summary.taxable },
        { Field: "CGST", Value: data.summary.cgst },
        { Field: "SGST", Value: data.summary.sgst },
        { Field: "IGST", Value: data.summary.igst },
        { Field: "Invoice Value", Value: data.summary.total },
      ]),
      "Summary"
    );

    XLSX.writeFile(wb, `GSTR1_${from}_to_${to}.xlsx`);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-onyx text-saffron flex items-center justify-center">
          <FileSpreadsheet size={20} />
        </div>
        <div>
          <h1 className="text-xl font-heading font-bold text-onyx">GSTR-1 / Sales Register</h1>
          <p className="text-xs text-onyx/50">B2B, B2C &amp; HSN summary with CGST/SGST/IGST split — export to Excel</p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white border border-onyx/10 rounded-xl p-4 mb-6 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-semibold text-onyx/60 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-onyx/60 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-5 py-2 bg-saffron hover:bg-saffron-dark text-onyx font-semibold rounded-lg text-sm disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : null}
          {loading ? "Loading…" : "Load"}
        </button>
        {data && (
          <button
            onClick={exportExcel}
            className="px-5 py-2 bg-onyx hover:bg-onyx-light text-cream-light font-semibold rounded-lg text-sm flex items-center gap-2"
          >
            <Download size={15} /> Export Excel
          </button>
        )}
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>

      {data && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
            {[
              { label: "Invoices", value: String(data.summary.count) },
              { label: "Taxable", value: inr(data.summary.taxable) },
              { label: "CGST", value: inr(data.summary.cgst) },
              { label: "SGST", value: inr(data.summary.sgst) },
              { label: "IGST", value: inr(data.summary.igst) },
            ].map((k) => (
              <div key={k.label} className="bg-white border border-onyx/10 rounded-xl p-4">
                <div className="text-[10px] uppercase font-bold text-onyx/50 tracking-wider">{k.label}</div>
                <div className="text-lg font-heading font-bold text-onyx mt-1">{k.value}</div>
              </div>
            ))}
          </div>

          {/* Invoice rows */}
          <div className="bg-white border border-onyx/10 rounded-xl overflow-hidden mb-8">
            <div className="px-4 py-3 border-b border-onyx/10 font-semibold text-onyx text-sm">
              Invoices ({data.rows.length})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-cream-light text-onyx/60 uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-3 py-2">Type</th>
                    <th className="text-left px-3 py-2">Invoice</th>
                    <th className="text-left px-3 py-2">Date</th>
                    <th className="text-left px-3 py-2">Customer / GSTIN</th>
                    <th className="text-left px-3 py-2">POS</th>
                    <th className="text-right px-3 py-2">Taxable</th>
                    <th className="text-right px-3 py-2">CGST</th>
                    <th className="text-right px-3 py-2">SGST</th>
                    <th className="text-right px-3 py-2">IGST</th>
                    <th className="text-right px-3 py-2">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-onyx/5">
                  {data.rows.map((r, i) => (
                    <tr key={i} className="hover:bg-cream-light/40">
                      <td className="px-3 py-2">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${r.type === "B2B" ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"}`}>{r.type}</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-onyx/70">{r.invoiceNo}</td>
                      <td className="px-3 py-2 text-onyx/60">{r.invoiceDate}</td>
                      <td className="px-3 py-2 text-onyx">
                        {r.customerName}
                        {r.gstin && <span className="block text-[10px] text-onyx/40 font-mono">{r.gstin}</span>}
                      </td>
                      <td className="px-3 py-2 text-onyx/60">{r.placeOfSupply}</td>
                      <td className="px-3 py-2 text-right">{r.taxable.toLocaleString("en-IN")}</td>
                      <td className="px-3 py-2 text-right text-onyx/60">{r.cgst.toLocaleString("en-IN")}</td>
                      <td className="px-3 py-2 text-right text-onyx/60">{r.sgst.toLocaleString("en-IN")}</td>
                      <td className="px-3 py-2 text-right text-onyx/60">{r.igst.toLocaleString("en-IN")}</td>
                      <td className="px-3 py-2 text-right font-semibold text-onyx">{r.total.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr><td colSpan={10} className="px-3 py-10 text-center text-onyx/40">No invoices in this period.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* HSN summary */}
          <div className="bg-white border border-onyx/10 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-onyx/10 font-semibold text-onyx text-sm">HSN Summary</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-cream-light text-onyx/60 uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-3 py-2">HSN</th>
                    <th className="text-right px-3 py-2">Qty</th>
                    <th className="text-right px-3 py-2">Taxable</th>
                    <th className="text-right px-3 py-2">CGST</th>
                    <th className="text-right px-3 py-2">SGST</th>
                    <th className="text-right px-3 py-2">IGST</th>
                    <th className="text-right px-3 py-2">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-onyx/5">
                  {data.hsn.map((h, i) => (
                    <tr key={i} className="hover:bg-cream-light/40">
                      <td className="px-3 py-2 font-mono text-onyx/70">{h.hsn}</td>
                      <td className="px-3 py-2 text-right">{h.qty}</td>
                      <td className="px-3 py-2 text-right">{h.taxable.toLocaleString("en-IN")}</td>
                      <td className="px-3 py-2 text-right text-onyx/60">{h.cgst.toLocaleString("en-IN")}</td>
                      <td className="px-3 py-2 text-right text-onyx/60">{h.sgst.toLocaleString("en-IN")}</td>
                      <td className="px-3 py-2 text-right text-onyx/60">{h.igst.toLocaleString("en-IN")}</td>
                      <td className="px-3 py-2 text-right font-semibold text-onyx">{h.total.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                  {data.hsn.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-10 text-center text-onyx/40">No line data.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

const inputCls = "px-3 py-2 border border-onyx/15 rounded-lg text-sm focus:ring-2 focus:ring-saffron/40 outline-none";
