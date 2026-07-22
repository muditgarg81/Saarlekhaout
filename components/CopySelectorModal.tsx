"use client";

import React, { useState } from "react";
import { X, FileText } from "lucide-react";

interface CopySelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (selected: string[]) => void;
  docNumber: string;
}

export default function CopySelectorModal({
  isOpen,
  onClose,
  onConfirm,
  docNumber,
}: CopySelectorModalProps) {
  const [options, setOptions] = useState([
    { key: "original", label: "Original for Buyer", enabled: true },
    { key: "duplicate", label: "Duplicate for Transporter", enabled: true },
    { key: "triplicate", label: "Triplicate for Assessee", enabled: true },
    { key: "quadruplicate", label: "Quadruplicate", enabled: false },
  ]);

  if (!isOpen) return null;

  const toggleOption = (idx: number) => {
    setOptions(
      options.map((opt, i) => (i === idx ? { ...opt, enabled: !opt.enabled } : opt))
    );
  };

  const handleExport = () => {
    const selected = options.filter((o) => o.enabled).map((o) => o.label);
    onConfirm(selected);
  };

  return (
    <div className="fixed inset-0 bg-black/45 z-55 flex items-center justify-center p-4 backdrop-blur-xs">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl p-6 font-body relative overflow-hidden border border-onyx/5">
        {/* Header */}
        <div className="flex justify-between items-center pb-4 border-b border-onyx/5 mb-5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-onyx text-saffron flex items-center justify-center">
              <FileText size={16} />
            </div>
            <div>
              <h3 className="text-sm font-heading font-bold text-onyx">Export Copies</h3>
              <p className="text-[10px] text-onyx/40 font-mono mt-0.5">{docNumber}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-onyx/40 hover:text-onyx cursor-pointer p-1">
            <X size={18} />
          </button>
        </div>

        {/* Options */}
        <div className="space-y-3 mb-6">
          <p className="text-xs text-onyx/60 font-semibold mb-2">Select copies to include in the PDF:</p>
          {options.map((opt, idx) => (
            <label
              key={opt.key}
              className={`flex items-center justify-between p-3 rounded-xl border text-xs cursor-pointer select-none transition-all ${
                opt.enabled
                  ? "bg-saffron/5 border-saffron/40 text-onyx font-bold"
                  : "bg-white border-onyx/10 text-onyx/50 hover:bg-cream-light/30"
              }`}
            >
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={opt.enabled}
                  onChange={() => toggleOption(idx)}
                  className="rounded text-saffron focus:ring-saffron w-4 h-4 cursor-pointer accent-saffron"
                />
                {opt.label}
              </span>
            </label>
          ))}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-3 border-t border-onyx/5">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-onyx/15 hover:bg-cream-light/30 text-onyx/60 font-semibold rounded-lg text-xs transition"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={!options.some((o) => o.enabled)}
            className="px-5 py-2 bg-saffron hover:bg-saffron-dark text-onyx font-bold rounded-lg text-xs shadow-sm disabled:opacity-50 transition"
          >
            Export PDF
          </button>
        </div>
      </div>
    </div>
  );
}
