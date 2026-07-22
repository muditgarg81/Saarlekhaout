import { db } from "./db";

/**
 * Generates the next sequential document number for a company.
 * Runs inside a database transaction to prevent duplicate sequences.
 * 
 * @param companyId The ID of the tenant company
 * @param docType The document type code (IND | PR | RFQ | PO | GRN | ISS | MRN | GP | INSP | DN | CN | PAY | SO | DC | SI | RV | SCN | SDN)
 * @returns Formatted sequence string (e.g. "IND-00001")
 */
export async function getNextSequence(
  companyId: string,
  docType:
    | "IND" | "PR" | "RFQ" | "PO" | "GRN" | "ISS" | "MRN" | "GP" | "INSP" | "DN" | "CN" | "PAY" | "PRQ"
    // Sales & Dispatch (order-to-cash): Sales Order, Delivery Challan/Dispatch,
    // Sales Invoice, Receipt Voucher, Sales Credit/Debit Note, Quotation.
    | "SO" | "DC" | "SI" | "RV" | "SCN" | "SDN" | "QT" | "PK"
): Promise<string> {
  return await db.$transaction(async (tx) => {
    const sequence = await tx.docSequence.upsert({
      where: {
        companyId_docType: {
          companyId,
          docType,
        },
      },
      update: {
        nextValue: {
          increment: 1,
        },
      },
      create: {
        companyId,
        docType,
        nextValue: 2, // Next value will be 2, current is 1
      },
    });

    const scheme = await tx.numberingScheme.findUnique({
      where: {
        companyId_docType: {
          companyId,
          docType,
        },
      },
    });

    const prefix = scheme?.prefix ?? `${docType}-`;
    const padding = scheme?.padding ?? 5;

    // If it was just created, nextValue was set to 2, so current is 1.
    // If it was updated, nextValue was incremented, so the value we want is nextValue - 1.
    const currentValue = sequence.nextValue - 1;
    const paddedValue = String(currentValue).padStart(padding, "0");
    return `${prefix}${paddedValue}`;
  });
}
