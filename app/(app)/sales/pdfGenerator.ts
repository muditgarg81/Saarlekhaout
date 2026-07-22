import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export function generatePDF(docType: "Quotation" | "Sales Order", data: any, company: any) {
  const doc = new jsPDF();
  
  // Page boundaries: Width: 210, Height: 297 (A4)
  
  // 1. Company Header (Seller details)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(33, 33, 33);
  doc.text(company?.name || "Crox Oil & Gas Pvt. Ltd.", 14, 20);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(80, 80, 80);
  doc.text(company?.address || "Address not configured.", 14, 25, { maxWidth: 110 });
  doc.text(`GSTIN: ${company?.gstin || "N/A"} | PAN: ${company?.pan || "N/A"}`, 14, 35);
  doc.text(`Email: ${company?.contactEmail || "N/A"} | Phone: ${company?.contactPhone || "N/A"}`, 14, 39);
  
  // Right side: Document Title and Meta
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(217, 119, 6); // Saffron / Orange color
  doc.text(docType.toUpperCase(), 140, 20);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(33, 33, 33);
  doc.text(`${docType} #: ${data.number}`, 140, 26);
  doc.text(`Date: ${new Date(data.quotationDate || data.orderDate).toLocaleDateString("en-IN")}`, 140, 31);
  if (data.validUpto || data.deliveryDate) {
    doc.text(
      data.validUpto 
        ? `Valid Upto: ${new Date(data.validUpto).toLocaleDateString("en-IN")}` 
        : `Delivery Date: ${new Date(data.deliveryDate).toLocaleDateString("en-IN")}`, 
      140, 
      36
    );
  }
  
  // Divider line
  doc.setLineWidth(0.3);
  doc.setDrawColor(200, 200, 200);
  doc.line(14, 44, 196, 44);
  
  // 2. Buyer (Customer) & Dispatch Details
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(33, 33, 33);
  doc.text("CUSTOMER DETAILS", 14, 52);
  
  doc.setFont("helvetica", "normal");
  doc.text(data.customer, 14, 57);
  doc.text(`Payment Terms: ${data.paymentTerms || "N/A"}`, 14, 62);
  doc.text(`Place of Supply: ${data.placeOfSupply || "N/A"}`, 14, 67);
  
  doc.setFont("helvetica", "bold");
  doc.text("BILLING & SHIPPING ADDRESS", 110, 52);
  doc.setFont("helvetica", "normal");
  doc.text(`Billing: ${data.billingAddress || "N/A"}`, 110, 57, { maxWidth: 85 });
  doc.text(`Shipping: ${data.shippingAddress || "N/A"}`, 110, 70, { maxWidth: 85 });
  
  // 3. Line Items Table using autoTable
  const headers = [["#", "Item Description", "Qty", "Basic Price", "Disc %", "GST %", "Total (INR)"]];
  
  const rows = (data.lines || []).map((l: any, index: number) => {
    const itemSubtotal = l.qty * l.rate * (1 - l.discount / 100) * (1 + l.gstRate / 100);
    return [
      index + 1,
      l.itemName || "Unknown Item",
      l.qty,
      `₹${l.rate.toLocaleString("en-IN")}`,
      `${l.discount}%`,
      `${l.gstRate}%`,
      `₹${itemSubtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
    ];
  });
  
  autoTable(doc, {
    startY: 85,
    head: headers,
    body: rows,
    theme: "striped",
    headStyles: { fillColor: [33, 33, 33], textColor: [255, 255, 255], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 70 },
      2: { cellWidth: 15, halign: "center" },
      3: { cellWidth: 25, halign: "right" },
      4: { cellWidth: 15, halign: "center" },
      5: { cellWidth: 15, halign: "center" },
      6: { cellWidth: 32, halign: "right" }
    }
  });
  
  // 4. Summary & Terms (at the bottom)
  let finalY = (doc as any).lastAutoTable.finalY + 12;
  
  // Check if we need a new page for terms/signatory
  if (finalY > 230) {
    doc.addPage();
    finalY = 20;
  }
  
  // Totals box on the right
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("SUMMARY", 140, finalY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Grand Total: ₹${data.value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 140, finalY + 6);
  
  // Terms & conditions on the left
  if (data.termsConditions) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("TERMS & CONDITIONS", 14, finalY);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(80, 80, 80);
    doc.text(data.termsConditions, 14, finalY + 5, { maxWidth: 110 });
  }
  
  // Save/Download PDF
  doc.save(`${docType.replace(/\s+/g, "_")}_${data.number}.pdf`);
}
