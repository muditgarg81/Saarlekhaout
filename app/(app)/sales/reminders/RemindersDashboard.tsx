"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { scanAndSendReminders, sendSingleReminder } from "@/app/actions/reminders";
import { AlertTriangle, Clock, RefreshCw, Send, CheckCircle, Mail, FileText, ChevronRight } from "lucide-react";
import { SessionUser } from "@/lib/rbac";

interface OverdueInvoice {
  id: string;
  number: string;
  customerName: string;
  customerEmail: string;
  totalAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  dueDate: string | null;
  reminderCount: number;
  lastReminderSentAt: string | null;
}

interface ReminderLog {
  id: string;
  invoiceNo: string;
  customerName: string;
  sentAt: string;
  sentTo: string;
  status: string;
  method: string;
}

export default function RemindersDashboard({
  overdueInvoices,
  remindersLog,
  user,
}: {
  overdueInvoices: OverdueInvoice[];
  remindersLog: ReminderLog[];
  user: SessionUser;
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"overdue" | "history">("overdue");
  const [runningAgent, setRunningAgent] = useState(false);
  const [sendingSingle, setSendingSingle] = useState<string | null>(null);

  const totalOverdueAmount = overdueInvoices.reduce((s, inv) => s + inv.outstandingAmount, 0);
  const totalRemindersCount = remindersLog.length;

  const handleRunAgent = async () => {
    setRunningAgent(true);
    const res = await scanAndSendReminders();
    setRunningAgent(false);
    if (res.success) {
      alert(`Reminder Agent ran successfully! Dispatched ${res.count} reminders.`);
      router.refresh();
    } else {
      alert(`Error running agent: ${res.error}`);
    }
  };

  const handleSendSingle = async (invId: string) => {
    setSendingSingle(invId);
    const res = await sendSingleReminder(invId);
    setSendingSingle(null);
    if (res.success) {
      alert("Payment reminder successfully sent!");
      router.refresh();
    } else {
      alert(`Error sending reminder: ${res.error}`);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-onyx text-saffron flex items-center justify-center shrink-0">
            <AlertTriangle size={20} />
          </div>
          <div>
            <h1 className="text-xl font-heading font-bold text-onyx">Payment Reminders Agent</h1>
            <p className="text-xs text-onyx/50">Auto-scan overdue accounts receivables and dispatch reminders</p>
          </div>
        </div>

        <button
          onClick={handleRunAgent}
          disabled={runningAgent}
          className="flex items-center justify-center gap-2 bg-saffron hover:bg-saffron-dark disabled:opacity-50 text-onyx font-semibold px-4 py-2.5 rounded-lg text-sm transition-all duration-150"
        >
          <RefreshCw size={16} className={runningAgent ? "animate-spin" : ""} />
          <span>{runningAgent ? "Running Agent Scan..." : "Run Reminder Agent"}</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Overdue */}
        <div className="bg-white border border-onyx/10 p-5 rounded-2xl flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center shrink-0">
            <Clock size={20} />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider">Total Outstanding Overdue</p>
            <h2 className="text-xl font-heading font-bold text-onyx mt-0.5">
              ₹{totalOverdueAmount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
            </h2>
          </div>
        </div>

        {/* Count Overdue */}
        <div className="bg-white border border-onyx/10 p-5 rounded-2xl flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
            <FileText size={20} />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider">Overdue Invoices</p>
            <h2 className="text-xl font-heading font-bold text-onyx mt-0.5">
              {overdueInvoices.length} invoices
            </h2>
          </div>
        </div>

        {/* Reminders Dispatched */}
        <div className="bg-white border border-onyx/10 p-5 rounded-2xl flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-green-50 text-green-600 flex items-center justify-center shrink-0">
            <CheckCircle size={20} />
          </div>
          <div>
            <p className="text-[10px] uppercase font-bold text-onyx/40 tracking-wider">Reminders Logged</p>
            <h2 className="text-xl font-heading font-bold text-onyx mt-0.5">
              {totalRemindersCount} runs
            </h2>
          </div>
        </div>
      </div>

      {/* Tabs Layout */}
      <div className="bg-white border border-onyx/10 rounded-2xl overflow-hidden shadow-xs">
        {/* Tab Headers */}
        <div className="flex border-b border-onyx/5 bg-cream-light/30">
          <button
            onClick={() => setActiveTab("overdue")}
            className={`px-6 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all duration-150 ${
              activeTab === "overdue"
                ? "border-saffron text-onyx bg-white"
                : "border-transparent text-onyx/40 hover:text-onyx"
            }`}
          >
            Overdue Invoices ({overdueInvoices.length})
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`px-6 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-all duration-150 ${
              activeTab === "history"
                ? "border-saffron text-onyx bg-white"
                : "border-transparent text-onyx/40 hover:text-onyx"
            }`}
          >
            Reminder Log ({totalRemindersCount})
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-4">
          {activeTab === "overdue" ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-cream-light text-onyx/60 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Invoice #</th>
                    <th className="text-left px-4 py-3 font-semibold">Customer</th>
                    <th className="text-left px-4 py-3 font-semibold">Due Date</th>
                    <th className="text-right px-4 py-3 font-semibold">Outstanding</th>
                    <th className="text-center px-4 py-3 font-semibold">Reminder Runs</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-onyx/5">
                  {overdueInvoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-cream-light/40">
                      <td className="px-4 py-3 font-mono text-xs text-onyx/70">{inv.number}</td>
                      <td className="px-4 py-3">
                        <div className="text-onyx font-medium">{inv.customerName}</div>
                        <div className="text-[10px] text-onyx/40 flex items-center gap-1 mt-0.5">
                          <Mail size={10} />
                          <span>{inv.customerEmail}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-red-600 font-semibold">
                        {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString("en-IN") : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-onyx">
                        ₹{inv.outstandingAmount.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center">
                          <span className="font-semibold text-onyx">{inv.reminderCount}</span>
                          {inv.lastReminderSentAt && (
                            <span className="text-[9px] text-onyx/40 mt-0.5">
                              Last: {new Date(inv.lastReminderSentAt).toLocaleDateString("en-IN")}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleSendSingle(inv.id)}
                          disabled={sendingSingle === inv.id}
                          className="flex items-center gap-1.5 ml-auto text-xs bg-saffron hover:bg-saffron-dark text-onyx font-bold px-3 py-1.5 rounded-lg transition-all duration-150 disabled:opacity-50"
                        >
                          <Send size={12} />
                          <span>{sendingSingle === inv.id ? "Sending..." : "Send Reminder"}</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                  {overdueInvoices.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-onyx/40 text-sm">
                        Hooray! No overdue invoices found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-cream-light text-onyx/60 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Sent At</th>
                    <th className="text-left px-4 py-3 font-semibold">Invoice #</th>
                    <th className="text-left px-4 py-3 font-semibold">Customer</th>
                    <th className="text-left px-4 py-3 font-semibold">Recipient</th>
                    <th className="text-left px-4 py-3 font-semibold">Method</th>
                    <th className="text-left px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-onyx/5">
                  {remindersLog.map((log) => (
                    <tr key={log.id} className="hover:bg-cream-light/40">
                      <td className="px-4 py-3 text-xs text-onyx/60">
                        {new Date(log.sentAt).toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-onyx/70">{log.invoiceNo}</td>
                      <td className="px-4 py-3 text-onyx">{log.customerName}</td>
                      <td className="px-4 py-3 text-xs text-onyx/60">{log.sentTo}</td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-bold text-onyx/60 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded">
                          {log.method}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
                          {log.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {remindersLog.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-onyx/40 text-sm">
                        No reminder runs recorded in history log yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
