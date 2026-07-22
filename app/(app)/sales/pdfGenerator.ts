import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (url.startsWith("http") && !url.startsWith(window.location.origin)) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function numberToWords(num: number): string {
  if (num === 0) return "Zero";
  
  const single = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const double = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  
  const formatWords = (n: number): string => {
    if (n < 20) return single[n];
    const digit = n % 10;
    if (n < 100) return double[Math.floor(n / 10)] + (digit ? " " + single[digit] : "");
    const hundred = Math.floor(n / 100);
    const rest = n % 100;
    return single[hundred] + " Hundred" + (rest ? " and " + formatWords(rest) : "");
  };

  const convert = (n: number): string => {
    n = Math.floor(n);
    if (n < 100) return formatWords(n);
    if (n < 1000) return formatWords(n);
    
    const thousand = Math.floor(n / 1000) % 100;
    const lakh = Math.floor(n / 100000) % 100;
    const crore = Math.floor(n / 10000000);
    const hundredRange = n % 1000;
    
    let parts: string[] = [];
    if (crore > 0) parts.push(convert(crore) + " Crore");
    if (lakh > 0) parts.push(formatWords(lakh) + " Lakh");
    if (thousand > 0) parts.push(formatWords(thousand) + " Thousand");
    if (hundredRange > 0) parts.push(formatWords(hundredRange));
    
    return parts.join(", ");
  };

  const words = convert(num);
  return words ? words + " Rupees Only" : "";
}

export async function generatePDF(docType: "Quotation" | "Sales Order", data: any, company: any) {
  const doc = new jsPDF();
  
  let startX = 14;
  if (company?.logoUrl) {
    const fullLogoUrl = window.location.origin + company.logoUrl;
    const img = await loadImage(fullLogoUrl);
    if (img) {
      const originalWidth = img.width || 1;
      const originalHeight = img.height || 1;
      const aspectRatio = originalWidth / originalHeight;
      
      let imgHeight = 20;
      let imgWidth = imgHeight * aspectRatio;
      
      if (imgWidth > 32) {
        imgWidth = 32;
        imgHeight = imgWidth / aspectRatio;
      }
      
      const textCenterY = 30; // Center of text block (y = 20 to y = 40)
      const logoY = textCenterY - imgHeight / 2;
      
      doc.addImage(img, "JPEG", 14, logoY, imgWidth, imgHeight);
      startX = 14 + imgWidth + 6; 
    }
  }
  
  // 1. Company Header (Seller details)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(33, 33, 33);
  doc.text(company?.name || "Crox Oil & Gas Pvt. Ltd.", startX, 20);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);
  
  const companyFullAddress = [
    company?.address,
    company?.city,
    company?.governingPlace
  ].filter(Boolean).join(", ");

  const maxTextWidth = 196 - startX;
  doc.text(companyFullAddress || "Address not configured.", startX, 24.5, { maxWidth: maxTextWidth });
  
  const detailsY = startX === 14 ? 35 : 36;
  doc.text(`GSTIN: ${company?.gstin || "N/A"} | PAN: ${company?.pan || "N/A"}`, startX, detailsY);
  doc.text(`Email: ${company?.contactEmail || "N/A"} | Phone: ${company?.contactPhone || "N/A"}`, startX, detailsY + 4);
  
  // Right side: Document Title and Meta
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(217, 119, 6); 
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
  doc.text(`Lead Time: ${data.leadTime || "N/A"}`, 14, 72);
  doc.text(`GSTIN: ${data.customerGstin || "N/A"} | PAN: ${data.customerPan || "N/A"}`, 14, 77);
  
  doc.setFont("helvetica", "bold");
  doc.text("BILLING & SHIPPING ADDRESS", 110, 52);
  doc.setFont("helvetica", "normal");
  doc.text(`Billing: ${data.billingAddress || "N/A"}`, 110, 57, { maxWidth: 85 });
  doc.text(`Shipping: ${data.shippingAddress || "N/A"}`, 110, 72, { maxWidth: 85 });
  
  // 3. Line Items Table using autoTable
  const headers = [["#", "Item Description", "Qty", "Basic Price", "Disc %", "GST %", "Total (INR)"]];
  
  const rows = (data.lines || []).map((l: any, index: number) => {
    const itemSubtotal = l.qty * l.rate * (1 - l.discount / 100) * (1 + l.gstRate / 100);
    return [
      index + 1,
      l.itemName || "Unknown Item",
      l.qty,
      `Rs. ${l.rate.toLocaleString("en-IN")}`,
      `${l.discount}%`,
      `${l.gstRate}%`,
      `Rs. ${itemSubtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
    ];
  });
  
  autoTable(doc, {
    startY: 88,
    head: headers,
    body: rows,
    theme: "striped",
    headStyles: { fillColor: [33, 33, 33], textColor: [255, 255, 255], fontSize: 8 },
    bodyStyles: { fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 10 },
      1: { cellWidth: 65 },
      2: { cellWidth: 15, halign: "center" },
      3: { cellWidth: 25, halign: "right" },
      4: { cellWidth: 15, halign: "center" },
      5: { cellWidth: 15, halign: "center" },
      6: { cellWidth: 37, halign: "right" }
    }
  });
  
  // 4. Summary & Terms (at the bottom)
  let finalY = (doc as any).lastAutoTable.finalY + 12;
  
  if (finalY > 210) {
    doc.addPage();
    finalY = 20;
  }
  
  // Amount in Words
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(33, 33, 33);
  doc.text("Amount in Words:", 14, finalY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.text(numberToWords(data.value), 43, finalY, { maxWidth: 90 });
  
  // Totals box on the right
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("SUMMARY", 140, finalY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(`Grand Total: Rs. ${data.value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 140, finalY + 6);
  
  // Terms & conditions on the left
  if (data.termsConditions) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("TERMS & CONDITIONS", 14, finalY + 15);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(80, 80, 80);
    
    const lines = doc.splitTextToSize(data.termsConditions, 180);
    let termsY = finalY + 21;
    lines.forEach((line: string) => {
      if (termsY > 280) {
        doc.addPage();
        termsY = 20;
      }
      doc.text(line, 14, termsY);
      termsY += 5.5; 
    });
  }
  
  // Save/Download PDF
  doc.save(`${docType.replace(/\s+/g, "_")}_${data.number}.pdf`);
}
