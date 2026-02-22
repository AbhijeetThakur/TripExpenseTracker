import React, { useEffect, useMemo, useState } from "react";
import { GoogleGenAI, Type } from "@google/genai";
import { initializeApp } from "firebase/app";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getFirestore,
  getDocs,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore/lite";

// --- CONFIGURATION ---
const VOLUNTEER_PASSWORD = "Ujjain@2024";
const BUDGET_TOTAL = 500000;
const CATEGORIES = ["Food", "Water", "Transport", "Fine", "Stay", "Misc"];

// Vite env (supports both VITE_* and legacy keys via define() in vite.config.ts)
const env = import.meta.env ?? {};

function cleanEnvValue(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    return s.slice(1, -1).trim();
  }
  return s;
}

const GEMINI_API_KEY = cleanEnvValue(env.VITE_GEMINI_API_KEY ?? env.GEMINI_API_KEY);
const FB_API_KEY = cleanEnvValue(env.VITE_FB_API_KEY ?? env.FB_API_KEY);
const FB_PROJECT_ID = cleanEnvValue(env.VITE_FB_PROJECT_ID ?? env.FB_PROJECT_ID);
const FB_APP_ID = cleanEnvValue(env.VITE_FB_APP_ID ?? env.FB_APP_ID);
const FB_AUTH_DOMAIN = cleanEnvValue(env.VITE_FB_AUTH_DOMAIN ?? env.FB_AUTH_DOMAIN);

// Firebase Setup (Firestore only; no Storage)
const firebaseConfig = {
  apiKey: FB_API_KEY,
  projectId: FB_PROJECT_ID,
  appId: FB_APP_ID,
  authDomain: FB_AUTH_DOMAIN ?? (FB_PROJECT_ID ? `${FB_PROJECT_ID}.firebaseapp.com` : undefined),
};

const hasFirebase = !!(FB_API_KEY && FB_PROJECT_ID && FB_APP_ID);
let db = null;

if (hasFirebase) {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
}

// Gemini Setup
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

function estimateDataUrlBytes(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string") return 0;
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image blob."));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

function canvasToJpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("Canvas encoding failed."));
        else resolve(blob);
      },
      "image/jpeg",
      quality,
    );
  });
}

function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms / 1000}s. Check internet/Firebase config.`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function compressImageToJpegDataUrl(file, { maxWidth = 800, quality = 0.7 }) {
  // Prefer createImageBitmap when available for speed/memory.
  let source = null;
  let shouldClose = false;
  try {
    source = await createImageBitmap(file);
    shouldClose = typeof source.close === "function";
  } catch {
    source = null;
  }

  if (!source) {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    try {
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to decode image."));
        img.src = objectUrl;
      });
      source = img;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  const srcW = source.width;
  const srcH = source.height;
  const scale = srcW > maxWidth ? maxWidth / srcW : 1;
  const dstW = Math.max(1, Math.round(srcW * scale));
  const dstH = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas is not supported in this browser.");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, dstW, dstH);

  if (shouldClose) source.close();

  const blob = await canvasToJpegBlob(canvas, quality);
  const dataUrl = await blobToDataUrl(blob);
  return dataUrl;
}

// --- MAIN APP COMPONENT ---
export default function App() {
  const [expenses, setExpenses] = useState([]);
  const [isVolunteerMode, setIsVolunteerMode] = useState(false);
  const [isVolunteerAccess, setIsVolunteerAccess] = useState(false);
  const [searchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedProof, setSelectedProof] = useState(null);

  // Form State
  const [formTitle, setFormTitle] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formCategory, setFormCategory] = useState("Misc");
  const [formImage, setFormImage] = useState(null); // JPEG data URL
  const [editingId, setEditingId] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Data Sync
  useEffect(() => {
    if (hasFirebase) {
      let cancelled = false;
      let shownError = false;
      const q = query(collection(db, "expenses"), orderBy("timestamp", "desc"));

      const loadExpenses = async () => {
        try {
          const snapshot = await withTimeout(getDocs(q), 20000, "Fetch expenses");
          if (cancelled) return;
          const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
          setExpenses(docs);
        } catch (err) {
          console.error("Firestore fetch failed", err);
          if (!shownError) {
            shownError = true;
            const msg =
              err && typeof err === "object" && "message" in err ? err.message : String(err);
            alert(`Firestore connection error: ${msg}`);
          }
        }
      };

      loadExpenses();
      const intervalId = setInterval(loadExpenses, 5000);

      return () => {
        cancelled = true;
        clearInterval(intervalId);
      };
    }
    const saved = localStorage.getItem("trip_expenses");
    if (saved) setExpenses(JSON.parse(saved));
    return undefined;
  }, []);

  const stats = useMemo(() => {
    const spent = expenses.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    return {
      totalCollected: BUDGET_TOTAL,
      totalSpent: spent,
      remaining: BUDGET_TOTAL - spent,
    };
  }, [expenses]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      const title = (e.title ?? "").toString();
      const matchesSearch = title.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCat = selectedCategory === "All" || e.category === selectedCategory;
      return matchesSearch && matchesCat;
    });
  }, [expenses, searchTerm, selectedCategory]);

  // Image Compression + AI Extraction
  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Allow re-selecting the same file
    e.target.value = "";

    (async () => {
      setIsAnalyzing(true);
      try {
        const compressed = await compressImageToJpegDataUrl(file, {
          maxWidth: 800,
          quality: 0.7,
        });

        // Safety check vs Firestore 1MB document limit (best-effort).
        const approxBytes = estimateDataUrlBytes(compressed);
        if (approxBytes > 950_000) {
          alert(
            "This image is still too large after compression. Please crop it or take a closer photo of the receipt.",
          );
          setFormImage(null);
          return;
        }

        setFormImage(compressed);

        if (!ai) return; // Manual entry is allowed when Gemini isn't configured.
        const model = "gemini-3-flash-preview";
        const response = await ai.models.generateContent({
          model,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: compressed.split(",")[1],
                },
              },
              {
                text: "Extract: title, total amount, category (Food, Water, Transport, Fine, Stay, Misc). Return JSON.",
              },
            ],
          },
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                amount: { type: Type.NUMBER },
                category: { type: Type.STRING },
              },
            },
          },
        });
        const data = JSON.parse(response.text);
        setFormTitle(data.title || "");
        setFormAmount(data.amount?.toString() || "");
        if (CATEGORIES.includes(data.category)) setFormCategory(data.category);
      } catch (err) {
        console.error("Image processing / AI analysis failed", err);
      } finally {
        setIsAnalyzing(false);
      }
    })();
  };

  const resetForm = () => {
    setFormTitle("");
    setFormAmount("");
    setFormCategory("Misc");
    setFormImage(null);
    setEditingId(null);
  };

  const saveExpense = async () => {
    if (!formImage || !formTitle || !formAmount) return;
    setIsUploading(true);

    try {
      if (hasFirebase && !db) {
        throw new Error("Firestore is not initialized. Check your Firebase env variables.");
      }

      const expenseData = {
        title: formTitle,
        amount: Number.parseFloat(formAmount),
        category: formCategory,
        receiptBase64: formImage, // Firestore schema: store the data URL string
        timestamp: Date.now(),
        volunteerName: "Volunteer Team",
      };

      if (editingId) {
        if (hasFirebase) {
          await withTimeout(
            updateDoc(doc(db, "expenses", editingId), expenseData),
            45000,
            "Update expense",
          );
        } else {
          setExpenses((prev) => {
            const updated = prev.map((ex) =>
              ex.id === editingId ? { ...ex, ...expenseData } : ex,
            );
            localStorage.setItem("trip_expenses", JSON.stringify(updated));
            return updated;
          });
        }
      } else if (hasFirebase) {
        await withTimeout(addDoc(collection(db, "expenses"), expenseData), 45000, "Save expense");
      } else {
        const newExp = { id: Date.now().toString(), ...expenseData };
        const updated = [newExp, ...expenses];
        setExpenses(updated);
        localStorage.setItem("trip_expenses", JSON.stringify(updated));
      }

      resetForm();
      setIsVolunteerMode(false);
    } catch (err) {
      console.error(err);
      const msg =
        err && typeof err === "object" && "message" in err ? err.message : String(err);
      const code = err && typeof err === "object" && "code" in err ? ` (${err.code})` : "";
      alert(`Error saving expense${code}: ${msg}`);
    } finally {
      setIsUploading(false);
    }
  };

  const startEdit = (expense) => {
    setEditingId(expense.id);
    setFormTitle(expense.title || "");
    setFormAmount((expense.amount ?? "").toString());
    setFormCategory(expense.category || "Misc");
    setFormImage(expense.receiptBase64 || expense.imageUrl || null); // supports legacy docs
    setIsVolunteerMode(true);
  };

  const deleteExpenseById = async (id) => {
    try {
      if (!window.confirm("Delete this record permanently?")) return;
      if (hasFirebase) {
        if (!db) throw new Error("Firestore is not initialized. Check your Firebase env variables.");
        await withTimeout(deleteDoc(doc(db, "expenses", id)), 45000, "Delete expense");
      } else {
        const updated = expenses.filter((ex) => ex.id !== id);
        setExpenses(updated);
        localStorage.setItem("trip_expenses", JSON.stringify(updated));
      }
    } catch (err) {
      console.error(err);
      const msg =
        err && typeof err === "object" && "message" in err ? err.message : String(err);
      alert(`Error deleting expense: ${msg}`);
    }
  };

  const handleVolunteerLogin = () => {
    if (isVolunteerAccess) {
      setIsVolunteerAccess(false);
      setIsVolunteerMode(false);
      return;
    }
    const pw = prompt("Enter Volunteer Password:");
    if (pw === VOLUNTEER_PASSWORD) setIsVolunteerAccess(true);
    else alert("Incorrect Password");
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-20 select-none">
      {/* Analytics Header */}
      <header className="sticky top-0 z-40 bg-indigo-950 text-white shadow-2xl safe-top">
        <div className="px-5 py-4">
          <div className="flex justify-between items-center mb-5">
            <div>
              <h1 className="text-xl font-black tracking-tighter flex items-center gap-2">
                <span className="bg-orange-500 w-2 h-6 rounded-full"></span>
                EXPENSE LEDGER
              </h1>
              <p className="text-[10px] font-bold opacity-40 uppercase tracking-[0.2em]">
                Pune to Ujjain Journey
              </p>
            </div>
            <button
              onClick={handleVolunteerLogin}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                isVolunteerAccess
                  ? "bg-indigo-700 text-indigo-200"
                  : "bg-white/10 text-white/60"
              }`}
            >
              {isVolunteerAccess ? "Volunteer: ON" : "Public View"}
            </button>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Collected", val: stats.totalCollected, color: "text-white" },
              { label: "Spent", val: stats.totalSpent, color: "text-orange-400" },
              { label: "Balance", val: stats.remaining, color: "text-emerald-400" },
            ].map((s) => (
              <div
                key={s.label}
                className="bg-white/5 p-3 rounded-2xl border border-white/10 backdrop-blur-md"
              >
                <p className="text-[9px] font-black uppercase opacity-40 mb-1 tracking-wider">
                  {s.label}
                </p>
                <p className={`text-sm font-mono font-black ${s.color}`}>
                  ₹{Number(s.val || 0).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 p-5 max-w-lg mx-auto w-full">
        {isVolunteerMode ? (
          <div className="bg-white p-6 rounded-[2.5rem] shadow-2xl border border-slate-200 animate-in slide-in-from-bottom-8 duration-500">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-black text-slate-800">
                {editingId ? "Update Record" : "Log Expense"}
              </h2>
              <button
                onClick={() => {
                  setIsVolunteerMode(false);
                  resetForm();
                }}
                className="p-2 bg-slate-100 rounded-full text-slate-400"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="space-y-5">
              {/* IMAGE UPLOAD (compressed + stored in Firestore as Base64) */}
              <label
                className={`block w-full h-48 border-4 border-dashed rounded-[2rem] flex flex-col items-center justify-center cursor-pointer transition-all overflow-hidden relative ${
                  formImage
                    ? "border-emerald-400 bg-emerald-50/30"
                    : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                }`}
              >
                {formImage ? (
                  <img src={formImage} className="w-full h-full object-cover" alt="Receipt Preview" />
                ) : (
                  <div className="text-center p-6">
                    <div className="bg-indigo-600 text-white p-4 rounded-3xl inline-block mb-3 shadow-lg shadow-indigo-200">
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2.5}
                          d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2.5}
                          d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                    </div>
                    <p className="text-xs font-black text-slate-500 uppercase tracking-widest">
                      Capture Proof (Required)
                    </p>
                  </div>
                )}
                <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                {isAnalyzing && (
                  <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center">
                    <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                    <p className="mt-3 text-[10px] font-black text-indigo-600 uppercase tracking-tighter animate-pulse">
                      Processing Proof...
                    </p>
                  </div>
                )}
              </label>

              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="expenseTitle"
                    className="text-[10px] font-black uppercase text-slate-400 mb-1.5 ml-1 block tracking-widest"
                  >
                    Expense Title
                  </label>
                  <input
                    id="expenseTitle"
                    type="text"
                    value={formTitle}
                    onChange={(ev) => setFormTitle(ev.target.value)}
                    placeholder="What was this for?"
                    className="w-full px-5 py-4 bg-slate-100 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all font-bold text-slate-700"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="expenseAmount"
                      className="text-[10px] font-black uppercase text-slate-400 mb-1.5 ml-1 block tracking-widest"
                    >
                      Amount (₹)
                    </label>
                    <input
                      id="expenseAmount"
                      type="number"
                      value={formAmount}
                      onChange={(ev) => setFormAmount(ev.target.value)}
                      placeholder="0.00"
                      className="w-full px-5 py-4 bg-slate-100 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all font-mono font-black text-lg text-indigo-600"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="expenseCategory"
                      className="text-[10px] font-black uppercase text-slate-400 mb-1.5 ml-1 block tracking-widest"
                    >
                      Category
                    </label>
                    <select
                      id="expenseCategory"
                      value={formCategory}
                      onChange={(ev) => setFormCategory(ev.target.value)}
                      className="w-full px-5 py-4 bg-slate-100 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 outline-none font-bold text-slate-700 appearance-none"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <button
                onClick={saveExpense}
                disabled={!formImage || !formTitle || !formAmount || isUploading || isAnalyzing}
                className="w-full bg-indigo-600 text-white py-5 rounded-[1.5rem] font-black text-lg shadow-2xl shadow-indigo-300 disabled:opacity-20 transition-all active:scale-95 flex items-center justify-center gap-3"
              >
                {isUploading ? (
                  <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : editingId ? (
                  "Update Record"
                ) : (
                  "Post to Ledger"
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
              <button
                onClick={() => setSelectedCategory("All")}
                className={`flex-shrink-0 px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  selectedCategory === "All"
                    ? "bg-indigo-600 text-white shadow-xl"
                    : "bg-white text-slate-400"
                }`}
              >
                All Items
              </button>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`flex-shrink-0 px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    selectedCategory === cat
                      ? "bg-indigo-600 text-white shadow-xl"
                      : "bg-white text-slate-400"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {filteredExpenses.length === 0 ? (
                <div className="text-center py-24">
                  <div className="bg-slate-200 w-20 h-20 rounded-[2rem] flex items-center justify-center mx-auto mb-6 opacity-20">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                  <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest">
                    No transactions logged
                  </p>
                </div>
              ) : (
                filteredExpenses.map((expense) => {
                  const proofSrc = expense.receiptBase64 || expense.imageUrl || null;
                  return (
                    <div
                      key={expense.id}
                      className="group bg-white p-4 rounded-[2rem] shadow-sm border border-slate-100 flex gap-4 items-center active:scale-[0.98] transition-all"
                    >
                      <button
                        type="button"
                        className="w-16 h-16 rounded-[1.25rem] overflow-hidden flex-shrink-0 cursor-pointer border border-slate-100 shadow-inner"
                        onClick={() => proofSrc && setSelectedProof(proofSrc)}
                      >
                        {proofSrc ? (
                          <img src={proofSrc} className="w-full h-full object-cover" alt="Proof" />
                        ) : (
                          <div className="w-full h-full bg-slate-100" />
                        )}
                      </button>

                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start mb-0.5">
                          <span className="text-[9px] font-black uppercase text-indigo-500 tracking-[0.15em]">
                            {expense.category}
                          </span>
                          <span className="text-[9px] font-bold text-slate-300 font-mono">
                            {new Date(expense.timestamp).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <h3 className="font-bold text-slate-800 text-sm truncate pr-4">
                          {expense.title}
                        </h3>
                        <div className="flex justify-between items-end mt-1">
                          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter truncate opacity-60">
                            REF: {String(expense.id || "").slice(-6).toUpperCase()}
                          </p>
                          <p className="text-lg font-black text-slate-900 font-mono">
                            ₹{Number(expense.amount || 0).toLocaleString()}
                          </p>
                        </div>

                        {isVolunteerAccess && (
                          <div className="flex gap-2 mt-3 pt-3 border-t border-slate-50">
                            <button
                              onClick={() => startEdit(expense)}
                              className="px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-xl text-[9px] font-black uppercase"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => deleteExpenseById(expense.id)}
                              className="px-3 py-1.5 bg-red-50 text-red-600 rounded-xl text-[9px] font-black uppercase"
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </main>

      {/* Floating Action Bar (Volunteer Only) */}
      {isVolunteerAccess && !isVolunteerMode && (
        <div className="fixed bottom-6 right-6 z-50">
          <button
            onClick={() => setIsVolunteerMode(true)}
            className="w-16 h-16 bg-orange-500 text-white rounded-[1.5rem] shadow-2xl shadow-orange-300 flex items-center justify-center active:scale-90 transition-all border-4 border-white"
          >
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={3}
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Proof Modal */}
      {selectedProof && (
        <div className="fixed inset-0 z-[100] bg-indigo-950/90 backdrop-blur-3xl p-6 animate-in fade-in duration-300">
          <button
            type="button"
            aria-label="Close proof"
            className="absolute inset-0 z-0 w-full h-full"
            autoFocus
            onClick={() => setSelectedProof(null)}
            onKeyDown={(ev) => {
              if (ev.key === "Escape") setSelectedProof(null);
            }}
          />
          <div className="relative z-10 w-full h-full flex items-center justify-center pointer-events-none">
            <div className="relative w-full max-w-sm pointer-events-auto">
              <button
                type="button"
                className="absolute -top-12 right-0 text-white p-2"
                onClick={() => setSelectedProof(null)}
              >
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={3}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
              <div className="bg-white p-2 rounded-[2.5rem] shadow-2xl overflow-hidden ring-4 ring-white/20">
                <img
                  src={selectedProof}
                  className="w-full h-auto rounded-[2rem]"
                  alt="Proof Enlarged"
                />
              </div>
              <p className="text-white/50 text-center mt-6 text-[10px] font-black uppercase tracking-[0.2em]">
                Full Accountability Ledger
              </p>
            </div>
          </div>
        </div>
      )}

      <footer className="py-10 text-center opacity-20 safe-bottom">
        <p className="text-[9px] font-black uppercase tracking-[0.3em]">
          Pune ➔ Ujjain Digital Ledger 2024
        </p>
      </footer>
    </div>
  );
}

