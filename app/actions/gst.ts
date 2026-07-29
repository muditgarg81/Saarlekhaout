"use server";

import { auth } from "@/auth";
import { db } from "@/lib/db";

// GSTR-1 / GST sales-register data for a period. Returns per-invoice B2B/B2C
// rows (with CGST+SGST vs IGST split) and an HSN-wise summary — the shape
// accountants use to file/reconcile GSTR-1. Excel export is built client-side.

export type Gstr1Row = {
  invoiceNo: string;
  invoiceDate: string;
  customerName: string;
  gstin: string;
  placeOfSupply: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  type: "B2B" | "B2C";
};

export type Gstr1Hsn = {
  hsn: string;
  qty: number;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
};

export async function getGstr1(fromISO: string, toISO: string) {
  const session = await auth();
  if (!session || !session.user) return { success: false as const, error: "Unauthorized" };
  const companyId = (session.user as any).companyId;

  try {
    const from = new Date(fromISO);
    const to = new Date(toISO);
    to.setHours(23, 59, 59, 999);

    const invoices = await db.salesInvoice.findMany({
      where: {
        companyId,
        deletedAt: null,
        status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] },
        invoiceDate: { gte: from, lte: to },
      },
      include: { lines: true },
      orderBy: { invoiceDate: "asc" },
    });

    const customerIds = [...new Set(invoices.map((i) => i.customerId))];
    const customers = await db.customer.findMany({
      where: { companyId, id: { in: customerIds } },
      select: { id: true, name: true, gstin: true, stateCode: true },
    });
    const custMap = new Map(customers.map((c) => [c.id, c]));

    const rows: Gstr1Row[] = invoices.map((inv) => {
      const c = custMap.get(inv.customerId);
      return {
        invoiceNo: inv.number,
        invoiceDate: inv.invoiceDate.toISOString().slice(0, 10),
        customerName: c?.name || "—",
        gstin: c?.gstin || "",
        placeOfSupply: inv.placeOfSupply || c?.stateCode || c?.gstin?.slice(0, 2) || "",
        taxable: +inv.taxableAmount.toFixed(2),
        cgst: +inv.cgst.toFixed(2),
        sgst: +inv.sgst.toFixed(2),
        igst: +inv.igst.toFixed(2),
        total: +inv.totalAmount.toFixed(2),
        type: c?.gstin ? "B2B" : "B2C",
      };
    });

    // HSN-wise summary. Line tax = taxable * gstRate/100, split by whether the
    // parent invoice was intra-state (cgst>0) or inter-state (igst>0).
    const hsnMap = new Map<string, Gstr1Hsn>();
    for (const inv of invoices) {
      const intra = inv.cgst > 0 || (inv.igst === 0 && inv.cgst === 0);
      for (const l of inv.lines) {
        const key = l.hsnCode || "UNSPECIFIED";
        const tax = (l.taxable * l.gstRate) / 100;
        const row =
          hsnMap.get(key) ||
          { hsn: key, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
        row.qty += l.qty;
        row.taxable += l.taxable;
        if (intra) {
          row.cgst += tax / 2;
          row.sgst += tax / 2;
        } else {
          row.igst += tax;
        }
        row.total += l.taxable + tax;
        hsnMap.set(key, row);
      }
    }
    const hsn = [...hsnMap.values()].map((h) => ({
      hsn: h.hsn,
      qty: +h.qty.toFixed(3),
      taxable: +h.taxable.toFixed(2),
      cgst: +h.cgst.toFixed(2),
      sgst: +h.sgst.toFixed(2),
      igst: +h.igst.toFixed(2),
      total: +h.total.toFixed(2),
    }));

    const summary = rows.reduce(
      (s, r) => ({
        count: s.count + 1,
        taxable: +(s.taxable + r.taxable).toFixed(2),
        cgst: +(s.cgst + r.cgst).toFixed(2),
        sgst: +(s.sgst + r.sgst).toFixed(2),
        igst: +(s.igst + r.igst).toFixed(2),
        total: +(s.total + r.total).toFixed(2),
      }),
      { count: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 }
    );

    const company = await db.company.findUnique({
      where: { id: companyId },
      select: { name: true, legalName: true, gstin: true },
    });

    return {
      success: true as const,
      rows,
      hsn,
      summary,
      company: { name: company?.legalName || company?.name || "", gstin: company?.gstin || "" },
      period: { from: fromISO, to: toISO },
    };
  } catch (err: any) {
    console.error("GSTR-1 error:", err);
    return { success: false as const, error: err.message || "Failed to build GSTR-1" };
  }
}
