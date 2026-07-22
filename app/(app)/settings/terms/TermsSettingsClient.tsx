"use client";

import { useState } from "react";
import { 
  createTermsTemplate, 
  updateTermsTemplate, 
  deleteTermsTemplate, 
  setDefaultTermsTemplate 
} from "@/app/actions/terms";
import { 
  ClipboardList, 
  Plus, 
  Trash2, 
  Edit, 
  Check, 
  Save, 
  AlertCircle, 
  CheckCircle,
  FileText
} from "lucide-react";

interface Template {
  id: string;
  title: string;
  content: string;
  isDefault: boolean;
  createdAt: Date;
}

interface TermsSettingsClientProps {
  initialTemplates: Template[];
}

export default function TermsSettingsClient({ initialTemplates }: TermsSettingsClientProps) {
  const [templates, setTemplates] = useState<Template[]>(initialTemplates);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Form states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  const resetForm = () => {
    setEditingId(null);
    setTitle("");
    setContent("");
    setIsDefault(false);
    setMsg(null);
  };

  const handleEdit = (t: Template) => {
    setEditingId(t.id);
    setTitle(t.title);
    setContent(t.content);
    setIsDefault(t.isDefault);
    setMsg(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) {
      setMsg({ type: "error", text: "Title and Content are required." });
      return;
    }

    setLoading(true);
    setMsg(null);

    if (editingId) {
      // Update
      const res = await updateTermsTemplate(editingId, { title, content, isDefault });
      if (res.success && res.template) {
        const updated = res.template;
        setTemplates(prev => {
          let list = prev.map(t => t.id === editingId ? { ...t, title: updated.title, content: updated.content, isDefault: updated.isDefault } : t);
          if (isDefault) {
            list = list.map(t => t.id !== editingId ? { ...t, isDefault: false } : t);
          }
          return list;
        });
        setMsg({ type: "success", text: "Template updated successfully!" });
        resetForm();
      } else {
        setMsg({ type: "error", text: res.error || "Failed to update template." });
      }
    } else {
      // Create
      const res = await createTermsTemplate({ title, content, isDefault });
      if (res.success && res.template) {
        const created = res.template;
        setTemplates(prev => {
          let list = [...prev];
          if (isDefault) {
            list = list.map(t => ({ ...t, isDefault: false }));
          }
          return [created, ...list] as any;
        });
        setMsg({ type: "success", text: "Template created successfully!" });
        resetForm();
      } else {
        setMsg({ type: "error", text: res.error || "Failed to create template." });
      }
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this terms template?")) return;
    setLoading(true);
    setMsg(null);

    const res = await deleteTermsTemplate(id);
    if (res.success) {
      setTemplates(prev => prev.filter(t => t.id !== id));
      setMsg({ type: "success", text: "Template deleted successfully!" });
      if (editingId === id) resetForm();
    } else {
      setMsg({ type: "error", text: res.error || "Failed to delete template." });
    }
    setLoading(false);
  };

  const handleSetDefault = async (id: string) => {
    setLoading(true);
    setMsg(null);

    const res = await setDefaultTermsTemplate(id);
    if (res.success && res.template) {
      setTemplates(prev => prev.map(t => ({
        ...t,
        isDefault: t.id === id
      })));
      setMsg({ type: "success", text: "Default template updated successfully!" });
    } else {
      setMsg({ type: "error", text: res.error || "Failed to set default template." });
    }
    setLoading(false);
  };

  return (
    <div className="p-6 max-w-7xl mx-auto font-body">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-onyx text-saffron flex items-center justify-center">
          <ClipboardList size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-onyx">Terms & Conditions Templates</h1>
          <p className="text-xs text-onyx/60">
            Define standard templates to quickly populate the Terms & Conditions section in Quotations and Sales Orders.
          </p>
        </div>
      </div>

      {/* Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Form Container (1/3 width) */}
        <div className="bg-white border border-onyx/10 rounded-xl shadow-sm p-5 h-fit">
          <h2 className="text-sm font-bold text-onyx border-b border-onyx/5 pb-3 mb-4 flex items-center gap-1.5">
            <FileText size={16} className="text-saffron-dark" />
            <span>{editingId ? "Edit Template" : "Create Template"}</span>
          </h2>

          {msg && (
            <div className={`flex items-start gap-2 p-3 rounded-lg text-xs mb-4 ${
              msg.type === "success" ? "bg-green-50 text-green-800 border border-green-200" : "bg-red-50 text-red-800 border border-red-200"
            }`}>
              {msg.type === "success" ? <CheckCircle size={14} className="shrink-0 mt-0.5" /> : <AlertCircle size={14} className="shrink-0 mt-0.5" />}
              <span>{msg.text}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/60 mb-1">
                Template Title *
              </label>
              <input
                type="text"
                placeholder="e.g. Standard Domestic Sale, Export Contract"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full text-xs px-3 py-2 bg-cream-light/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron placeholder-onyx/30"
                required
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-onyx/60 mb-1">
                Terms Content *
              </label>
              <textarea
                placeholder="Write the full terms and conditions text here. You can use numbers or bullets."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={12}
                className="w-full text-xs px-3 py-2 bg-cream-light/30 border border-onyx/10 rounded-lg focus:outline-none focus:border-saffron placeholder-onyx/30 font-sans leading-relaxed"
                required
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isDefault"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="rounded text-saffron focus:ring-saffron border-onyx/20"
              />
              <label htmlFor="isDefault" className="text-xs text-onyx/80 select-none cursor-pointer">
                Set as Default Template
              </label>
            </div>

            <div className="flex gap-2 pt-2 border-t border-onyx/5">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-saffron hover:bg-saffron-dark text-onyx font-bold rounded-lg text-xs transition-colors disabled:opacity-50"
              >
                <Save size={14} />
                <span>{editingId ? "Update Template" : "Save Template"}</span>
              </button>
              
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-3 py-2 border border-onyx/10 hover:bg-cream-light text-onyx rounded-lg text-xs font-semibold"
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Templates List Container (2/3 width) */}
        <div className="lg:col-span-2 bg-white border border-onyx/10 rounded-xl shadow-sm p-5">
          <h2 className="text-sm font-bold text-onyx border-b border-onyx/5 pb-3 mb-4 flex items-center justify-between">
            <span>Existing Templates</span>
            <span className="text-[10px] bg-onyx/5 text-onyx/60 px-2 py-0.5 rounded-full font-semibold">
              {templates.length} {templates.length === 1 ? "template" : "templates"}
            </span>
          </h2>

          {templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 rounded-full bg-cream flex items-center justify-center text-onyx/30 mb-3">
                <ClipboardList size={22} />
              </div>
              <p className="text-xs text-onyx/50 font-medium">No terms templates defined yet.</p>
              <p className="text-[11px] text-onyx/40 mt-1 max-w-xs">
                Use the form on the left to add your first template and auto-fill terms on sales documents.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {templates.map((t) => (
                <div 
                  key={t.id} 
                  className={`border rounded-xl p-4 transition-all duration-200 ${
                    t.isDefault 
                      ? "border-saffron/40 bg-saffron/5 shadow-sm" 
                      : "border-onyx/5 bg-cream-light/5 hover:border-onyx/10 hover:bg-cream-light/10"
                  }`}
                >
                  {/* Title & Actions */}
                  <div className="flex items-center justify-between gap-4 mb-2">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-bold text-onyx">{t.title}</h3>
                      {t.isDefault ? (
                        <span className="text-[9px] font-bold text-saffron-dark bg-saffron/15 border border-saffron/30 px-1.5 py-0.5 rounded uppercase tracking-wide">
                          Default
                        </span>
                      ) : (
                        <button
                          onClick={() => handleSetDefault(t.id)}
                          disabled={loading}
                          className="text-[9px] font-semibold text-onyx/40 hover:text-saffron-dark bg-onyx/5 hover:bg-saffron/10 border border-transparent hover:border-saffron/20 px-1.5 py-0.5 rounded uppercase tracking-wide transition-colors"
                        >
                          Make Default
                        </button>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEdit(t)}
                        disabled={loading}
                        title="Edit Template"
                        className="p-1.5 text-onyx/60 hover:text-onyx hover:bg-onyx/5 rounded-lg transition-colors"
                      >
                        <Edit size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        disabled={loading}
                        title="Delete Template"
                        className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {/* Content Preview */}
                  <div className="bg-white/80 border border-onyx/5 rounded-lg p-3 text-xs text-onyx/80 leading-relaxed font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {t.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
