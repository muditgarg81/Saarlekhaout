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

export async function generatePDF(
  docType: "Quotation" | "Sales Order" | "Delivery Challan" | "Sales Invoice" | "Proforma Invoice",
  data: any,
  company: any,
  selectedCopies?: string[]
) {
  const doc = new jsPDF();
  
  const copies = selectedCopies && selectedCopies.length > 0 ? selectedCopies : [null];

  for (let cIdx = 0; cIdx < copies.length; cIdx++) {
    const copyLabel = copies[cIdx];
    if (cIdx > 0) {
      doc.addPage();
    }

    // Draw copy watermark label at the top if present
    if (copyLabel) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(180, 0, 0); // dark red
      doc.text(copyLabel.toUpperCase(), 14, 10);
    }

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
        
        // Vertically centre the logo on the (now compact) text block:
        // name baseline ~20 down to the email line ~34 → visual centre ~25.
        const textCenterY = 25;
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
    const addressLines = doc.splitTextToSize(companyFullAddress || "Address not configured.", maxTextWidth);
    doc.text(addressLines, startX, 24.5);

    // Tax details sit directly below the address (dynamic — adapts to 1 or 2 address lines).
    const detailsY = 24.5 + addressLines.length * 3.2 + 2;
    doc.text(`GSTIN: ${company?.gstin || "N/A"} | PAN: ${company?.pan || "N/A"}`, startX, detailsY);
    doc.text(`Email: ${company?.contactEmail || "N/A"} | Phone: ${company?.contactPhone || "N/A"}`, startX, detailsY + 4);
    
    // Right side: Document Title and Meta
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(217, 119, 6); 
    
    let displayTitle: string = docType;
    if (docType === "Delivery Challan") displayTitle = "DELIVERY CHALLAN";
    else if (docType === "Sales Invoice") displayTitle = "TAX INVOICE";
    doc.text(displayTitle.toUpperCase(), 140, 20);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(33, 33, 33);
    doc.text(`${docType === "Delivery Challan" ? "DC" : docType === "Sales Invoice" ? "Invoice" : docType === "Proforma Invoice" ? "Proforma" : docType} #: ${data.number}`, 140, 26);

    const docDate = data.quotationDate || data.orderDate || data.dispatchDate || data.invoiceDate || data.proformaDate || data.createdAt;
    doc.text(`Date: ${new Date(docDate).toLocaleDateString("en-IN")}`, 140, 31);

    if ((docType === "Quotation" || docType === "Proforma Invoice") && data.validUpto) {
      doc.text(`Valid Upto: ${new Date(data.validUpto).toLocaleDateString("en-IN")}`, 140, 36);
    } else if (docType === "Sales Order" && data.deliveryDate) {
      doc.text(`Delivery Date: ${new Date(data.deliveryDate).toLocaleDateString("en-IN")}`, 140, 36);
    } else if (docType === "Sales Invoice" && (data.dispatchNumber || data.dispatch?.number)) {
      doc.text(`DC #: ${data.dispatchNumber || data.dispatch?.number}`, 140, 36);
    } else if (docType === "Delivery Challan" && data.soNumber) {
      doc.text(`SO #: ${data.soNumber}`, 140, 36);
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
    doc.text(data.customer || data.customerName || "N/A", 14, 57);
    
    if (docType === "Delivery Challan") {
      doc.text(`Vehicle No: ${data.vehicleNo || "N/A"}`, 14, 62);
      doc.text(`Transporter: ${data.transporterName || "N/A"}`, 14, 67);
      doc.text(`LR / Docket No: ${data.lrNo || "N/A"}`, 14, 72);
      doc.text(`Distance: ${data.distanceKm ? data.distanceKm + " km" : "N/A"}`, 14, 77);
    } else {
      doc.text(`Payment Terms: ${data.paymentTerms || "N/A"}`, 14, 62);
      doc.text(`Place of Supply: ${data.placeOfSupply || "N/A"}`, 14, 67);
      doc.text(`Lead Time: ${data.leadTime || "N/A"}${data.deliveryTerms ? "   |   Delivery Terms: " + data.deliveryTerms : ""}`, 14, 72);
      doc.text(`GSTIN: ${data.customerGstin || "N/A"} | PAN: ${data.customerPan || "N/A"}`, 14, 77);
    }
    
    doc.setFont("helvetica", "bold");
    doc.text("BILLING & SHIPPING ADDRESS", 110, 52);
    doc.setFont("helvetica", "normal");
    doc.text(`Billing: ${data.billingAddress || data.billing || "N/A"}`, 110, 57, { maxWidth: 85 });
    doc.text(`Shipping: ${data.shippingAddress || data.shipping || "N/A"}`, 110, 72, { maxWidth: 85 });
    
    // 3. Line Items Table using autoTable
    let headers: string[][] = [];
    let rows: any[][] = [];
    let columnStyles: any = {};

    if (docType === "Delivery Challan") {
      headers = [["#", "Item Description", "Qty Dispatched", "Batch No"]];
      rows = (data.lines || []).map((l: any, index: number) => {
        const name = l.itemName || l.item?.name || "Unknown Item";
        const spec = l.specification || l.spec || l.item?.specification || "";
        const itemDesc = spec ? `${name}\nTech Spec: ${spec}` : name;
        return [
          index + 1,
          itemDesc,
          l.qty,
          l.batchNo || "—"
        ];
      });
      columnStyles = {
        0: { cellWidth: 15 },
        1: { cellWidth: 110 },
        2: { cellWidth: 30, halign: "right" },
        3: { cellWidth: 41, halign: "center" }
      };
    } else if (docType === "Sales Invoice") {
      headers = [["#", "Item Description", "HSN/SAC", "Qty", "Rate", "Disc %", "GST %", "Total (INR)"]];
      rows = (data.lines || []).map((l: any, index: number) => {
        const rate = l.rate ?? 0;
        const qty = l.qty ?? 0;
        const discount = l.discount ?? 0;
        const gstRate = l.gstRate ?? 0;
        const taxable = qty * rate * (1 - discount / 100);
        const lineTotal = taxable * (1 + gstRate / 100);
        const name = l.itemName || l.item?.name || "Unknown Item";
        const spec = l.specification || l.spec || l.item?.specification || "";
        const itemDesc = spec ? `${name}\nTech Spec: ${spec}` : name;
        return [
          index + 1,
          itemDesc,
          l.hsnCode || l.item?.hsnCode || "—",
          qty,
          `Rs. ${rate.toLocaleString("en-IN")}`,
          `${discount}%`,
          `${gstRate}%`,
          `Rs. ${lineTotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
        ];
      });
      columnStyles = {
        0: { cellWidth: 10 },
        1: { cellWidth: 60 },
        2: { cellWidth: 20 },
        3: { cellWidth: 15, halign: "center" },
        4: { cellWidth: 22, halign: "right" },
        5: { cellWidth: 15, halign: "center" },
        6: { cellWidth: 15, halign: "center" },
        7: { cellWidth: 39, halign: "right" }
      };
    } else {
      headers = [["#", "Item Description", "Qty", "Basic Price", "Disc %", "GST %", "Total (INR)"]];
      rows = (data.lines || []).map((l: any, index: number) => {
        const itemSubtotal = l.qty * l.rate * (1 - l.discount / 100) * (1 + l.gstRate / 100);
        const name = l.itemName || l.item?.name || "Unknown Item";
        const spec = l.specification || l.spec || l.item?.specification || "";
        const itemDesc = spec ? `${name}\nTech Spec: ${spec}` : name;
        return [
          index + 1,
          itemDesc,
          l.qty,
          `Rs. ${l.rate.toLocaleString("en-IN")}`,
          `${l.discount}%`,
          `${l.gstRate}%`,
          `Rs. ${itemSubtotal.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`
        ];
      });
      columnStyles = {
        0: { cellWidth: 10 },
        1: { cellWidth: 65 },
        2: { cellWidth: 15, halign: "center" },
        3: { cellWidth: 25, halign: "right" },
        4: { cellWidth: 15, halign: "center" },
        5: { cellWidth: 15, halign: "center" },
        6: { cellWidth: 37, halign: "right" }
      };
    }
    
    autoTable(doc, {
      startY: 88,
      head: headers,
      body: rows,
      theme: "striped",
      headStyles: { fillColor: [33, 33, 33], textColor: [255, 255, 255], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      columnStyles: columnStyles,
      didDrawPage: () => {
        if (copyLabel) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8.5);
          doc.setTextColor(180, 0, 0);
          doc.text(copyLabel.toUpperCase(), 14, 10);
        }
      }
    });
    
    // 4. Summary & Terms (at the bottom)
    let finalY = (doc as any).lastAutoTable.finalY + 12;
    
    if (finalY > 210) {
      doc.addPage();
      finalY = 20;
    }
    
    if (docType === "Delivery Challan") {
      const totalQty = data.lines?.reduce((s: number, l: any) => s + l.qty, 0) || 0;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(33, 33, 33);
      doc.text("QUANTITY SUMMARY", 14, finalY);
      
      doc.setFont("helvetica", "normal");
      doc.text(`Total Quantity: ${totalQty}`, 14, finalY + 6);
      if (data.packingListNumber) {
        doc.text(`Packing List: ${data.packingListNumber}`, 14, finalY + 12);
      }
      
      // Weights log on the right
      doc.setFont("helvetica", "bold");
      doc.text("WEIGHT LOG", 140, finalY);
      doc.setFont("helvetica", "normal");
      doc.text(`Net Weight: ${data.totalNetWeight?.toFixed(2) || "0.00"} kg`, 140, finalY + 6);
      doc.text(`Tare Weight: ${data.totalTareWeight?.toFixed(2) || "0.00"} kg`, 140, finalY + 12);
      doc.text(`Gross Weight: ${data.totalGrossWeight?.toFixed(2) || "0.00"} kg`, 140, finalY + 18);
      
      finalY = finalY + 18;
    } else if (docType === "Sales Invoice") {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(33, 33, 33);
      doc.text("Amount in Words:", 14, finalY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.text(numberToWords(data.totalAmount), 43, finalY, { maxWidth: 90 });
      
      if (data.irn) {
        doc.setFont("helvetica", "bold");
        doc.text("E-INVOICE IRN:", 14, finalY + 12);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.text(data.irn, 14, finalY + 17, { maxWidth: 100 });
      }
      
      // Totals box on the right
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.text("SUMMARY", 140, finalY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.text(`Taxable Amount: Rs. ${data.taxableAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 140, finalY + 6);
      
      let summaryY = finalY + 12;
      if (data.cgst > 0) {
        doc.text(`CGST: Rs. ${data.cgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 140, summaryY);
        summaryY += 5;
      }
      if (data.sgst > 0) {
        doc.text(`SGST: Rs. ${data.sgst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 140, summaryY);
        summaryY += 5;
      }
      if (data.igst > 0) {
        doc.text(`IGST: Rs. ${data.igst.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 140, summaryY);
        summaryY += 5;
      }
      if (data.otherCharges > 0) {
        doc.text(`Other Charges: Rs. ${data.otherCharges.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 140, summaryY);
        summaryY += 5;
      }
      doc.text(`Round Off: Rs. ${data.roundOff.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 140, summaryY);
      summaryY += 6;
      
      doc.setFont("helvetica", "bold");
      doc.text(`Grand Total: Rs. ${data.totalAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`, 140, summaryY);
      
      finalY = Math.max(finalY + 20, summaryY);
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(33, 33, 33);
      doc.text("Amount in Words:", 14, finalY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.text(numberToWords(data.value), 43, finalY, { maxWidth: 90 });
      
      // Compute the summary breakdown from the line items.
      let subTotal = 0, totalDiscount = 0, totalGst = 0;
      (data.lines || []).forEach((l: any) => {
        const gross = (l.qty || 0) * (l.rate || 0);
        const disc = gross * ((l.discount || 0) / 100);
        subTotal += gross;
        totalDiscount += disc;
        totalGst += (gross - disc) * ((l.gstRate || 0) / 100);
      });
      const grandTotal = subTotal - totalDiscount + totalGst;
      const rupees = (n: number) => `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(33, 33, 33);
      doc.text("SUMMARY", 140, finalY);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(60, 60, 60);
      const rows: [string, string][] = [
        ["Sub Total", rupees(subTotal)],
        ["Total Discount", rupees(totalDiscount)],
        ["Total GST", rupees(totalGst)],
      ];
      rows.forEach(([label, val], i) => {
        const y = finalY + 6 + i * 5;
        doc.text(label, 140, y);
        doc.text(val, 196, y, { align: "right" });
      });

      const gtY = finalY + 6 + rows.length * 5 + 1;
      doc.setDrawColor(200, 200, 200);
      doc.line(140, gtY - 3.5, 196, gtY - 3.5);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(33, 33, 33);
      doc.text("Grand Total", 140, gtY);
      doc.text(rupees(grandTotal), 196, gtY, { align: "right" });

      finalY = gtY;
    }
    
    // For proposal documents, start Terms & Conditions on a fresh page so that
    // T&C, Bank Details and the Signatory all sit together on one dedicated page.
    if (docType === "Quotation" || docType === "Sales Order") {
      doc.addPage();
      finalY = 6;
    }

    // Terms & conditions on the left
    let termsY = finalY + 6;
    if (data.termsConditions) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.text("TERMS & CONDITIONS", 14, finalY + 15);
      
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(80, 80, 80);
      
      const tLines = doc.splitTextToSize(data.termsConditions, 180);
      termsY = finalY + 21;
      tLines.forEach((line: string) => {
        if (termsY > 275) {
          doc.addPage();
          termsY = 20;
        }
        doc.text(line, 14, termsY);
        termsY += 5.5; 
      });
    }

    // Render Bank Details if enabled in Document Settings
    if (company?.showBankDetails && company?.bankDetails) {
      const bank = typeof company.bankDetails === "string" ? JSON.parse(company.bankDetails) : company.bankDetails;
      if (bank && (bank.bankName || bank.accountNumber)) {
        let bankY = termsY + 6;
        if (bankY > 260) {
          doc.addPage();
          bankY = 20;
        }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(33, 33, 33);
        doc.text("BANK PAYMENT DETAILS", 14, bankY);

        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(60, 60, 60);

        const bName = bank.bankName || "—";
        const accNo = bank.accountNumber || bank.accountNo || "—";
        const ifsc = bank.ifscCode || bank.ifsc || "—";
        const branch = bank.branchName || bank.branch || "—";

        doc.text(`Bank Name: ${bName}  |  Account No: ${accNo}`, 14, bankY + 5);
        doc.text(`IFSC Code: ${ifsc}  |  Branch Name: ${branch}`, 14, bankY + 9.5);

        termsY = bankY + 10;
      }
    }

    // Draw Authorized Signatory block at the bottom right
    let sigY = Math.max(finalY + 15, termsY) + 12;
    if (sigY > 265) {
      doc.addPage();
      sigY = 30;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(33, 33, 33);
    doc.text(`For ${company?.name || "Crox Oil & Gas Pvt. Ltd."}`, 135, sigY);
    
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("Authorized Signatory", 135, sigY + 15);
    const signatoryText = docType === "Quotation" 
      ? (company?.authorizedSignatory || "Sales Officer/ Director") 
      : (company?.authorizedSignatory || "");
    if (signatoryText) {
      doc.setFont("helvetica", "italic");
      doc.setFontSize(7.5);
      doc.text(`(${signatoryText})`, 135, sigY + 19);
    }
  }
  
  // Save/Download PDF
  doc.save(`${docType.replace(/\s+/g, "_")}_${data.number}.pdf`);
}
