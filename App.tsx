import React, { useState, useMemo, useEffect } from "react";
import { GoogleGenAI, Type } from "@google/genai";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  deleteDoc,
  doc,
  updateDoc,
} from "firebase/firestore";
import {
  getStorage,
  ref,
  uploadString,
  getDownloadURL,
} from "firebase/storage";
import { Expense, ExpenseCategory, TripStats } from "./types";

// --- CONFIGURATION ---
const VOLUNTEER_PASSWORD = "Ujjain@2024";
const BUDGET_TOTAL = 500000;
const CATEGORIES: ExpenseCategory[] = [
  "Food",
  "Water",
  "Transport",
  "Fine",
  "Stay",
  "Misc",
];

// Vite env (supports both VITE_* and legacy keys via define() in vite.config.ts)
const env = import.meta.env as any;
const GEMINI_API_KEY: string | undefined =
  env.VITE_GEMINI_API_KEY ?? env.GEMINI_API_KEY;
const FB_API_KEY: string | undefined = env.VITE_FB_API_KEY ?? env.FB_API_KEY;
const FB_PROJECT_ID: string | undefined =
  env.VITE_FB_PROJECT_ID ?? env.FB_PROJECT_ID;
const FB_STORAGE_BUCKET: string | undefined =
  env.VITE_FB_STORAGE_BUCKET ?? env.FB_STORAGE_BUCKET;
const FB_APP_ID: string | undefined = env.VITE_FB_APP_ID ?? env.FB_APP_ID;

// Firebase Setup (Mock-ready)
const firebaseConfig = {
  apiKey: FB_API_KEY,
  projectId: FB_PROJECT_ID,
  storageBucket: FB_STORAGE_BUCKET,
  appId: FB_APP_ID,
};

const hasFirebase = !!(
  FB_API_KEY &&
  FB_PROJECT_ID &&
  FB_STORAGE_BUCKET &&
  FB_APP_ID
);
let db: any = null;
let storage: any = null;

if (hasFirebase) {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  storage = getStorage(app);
}

// Gemini Setup
const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

// --- MAIN APP COMPONENT ---
const App: React.FC = () => {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isVolunteerMode, setIsVolunteerMode] = useState(false);
  const [isVolunteerAccess, setIsVolunteerAccess] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<
    ExpenseCategory | "All"
  >("All");
  const [selectedProof, setSelectedProof] = useState<string | null>(null);

  // Form State
  const [formTitle, setFormTitle] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formCategory, setFormCategory] = useState<ExpenseCategory>("Misc");
  const [formImage, setFormImage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // Data Sync
  useEffect(() => {
    if (hasFirebase) {
      const q = query(collection(db, "expenses"), orderBy("timestamp", "desc"));
      return onSnapshot(q, (snapshot) => {
        const docs = snapshot.docs.map(
          (d) => ({ id: d.id, ...d.data() }) as Expense,
        );
        setExpenses(docs);
      });
    } else {
      const saved = localStorage.getItem("trip_expenses");
      if (saved) setExpenses(JSON.parse(saved));
    }
  }, []);

  const stats = useMemo<TripStats>(() => {
    const spent = expenses.reduce((acc, curr) => acc + curr.amount, 0);
    return {
      totalCollected: BUDGET_TOTAL,
      totalSpent: spent,
      remaining: BUDGET_TOTAL - spent,
    };
  }, [expenses]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      const matchesSearch = e.title
        .toLowerCase()
        .includes(searchTerm.toLowerCase());
      const matchesCat =
        selectedCategory === "All" || e.category === selectedCategory;
      return matchesSearch && matchesCat;
    });
  }, [expenses, searchTerm, selectedCategory]);

  // AI & Image Logic
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      setFormImage(base64);

      setIsAnalyzing(true);
      try {
        if (!ai) {
          // Allow manual entry even when Gemini isn't configured.
          return;
        }
        const model = "gemini-3-flash-preview";
        const response = await ai.models.generateContent({
          model,
          contents: {
            parts: [
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: base64.split(",")[1],
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
        console.error("AI Analysis failed", err);
      } finally {
        setIsAnalyzing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const saveExpense = async () => {
    if (!formImage || !formTitle || !formAmount) return;
    setIsUploading(true);

    try {
      let finalImageUrl = formImage;
      if (hasFirebase && formImage.startsWith("data:")) {
        const storageRef = ref(storage, `receipts/${Date.now()}.jpg`);
        await uploadString(storageRef, formImage, "data_url");
        finalImageUrl = await getDownloadURL(storageRef);
      }

      const expenseData = {
        title: formTitle,
        amount: parseFloat(formAmount),
        category: formCategory,
        imageUrl: finalImageUrl,
        timestamp: Date.now(),
        volunteerName: "Volunteer Team",
      };

      if (editingId) {
        if (hasFirebase) {
          await updateDoc(doc(db, "expenses", editingId), expenseData);
        } else {
          setExpenses((prev) =>
            prev.map((e) =>
              e.id === editingId ? { ...e, ...expenseData } : e,
            ),
          );
        }
      } else {
        if (hasFirebase) {
          await addDoc(collection(db, "expenses"), expenseData);
        } else {
          const newExp = { id: Date.now().toString(), ...expenseData };
          const updated = [newExp, ...expenses];
          setExpenses(updated);
          localStorage.setItem("trip_expenses", JSON.stringify(updated));
        }
      }
      resetForm();
      setIsVolunteerMode(false);
    } catch (err) {
      alert("Error saving expense. Please check your connection.");
    } finally {
      setIsUploading(false);
    }
  };

  const resetForm = () => {
    setFormTitle("");
    setFormAmount("");
    setFormCategory("Misc");
    setFormImage(null);
    setEditingId(null);
  };

  const startEdit = (expense: Expense) => {
    setEditingId(expense.id);
    setFormTitle(expense.title);
    setFormAmount(expense.amount.toString());
    setFormCategory(expense.category);
    setFormImage(expense.imageUrl);
    setIsVolunteerMode(true);
  };

  const deleteExpense = async (id: string) => {
    if (!window.confirm("Delete this record permanently?")) return;
    if (hasFirebase) {
      await deleteDoc(doc(db, "expenses", id));
    } else {
      const updated = expenses.filter((e) => e.id !== id);
      setExpenses(updated);
      localStorage.setItem("trip_expenses", JSON.stringify(updated));
    }
  };

  const handleVolunteerLogin = () => {
    if (isVolunteerAccess) {
      setIsVolunteerAccess(false);
      setIsVolunteerMode(false);
    } else {
      const pw = prompt("Enter Volunteer Password:");
      if (pw === VOLUNTEER_PASSWORD) {
        setIsVolunteerAccess(true);
      } else {
        alert("Incorrect Password");
      }
    }
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
              {
                label: "Collected",
                val: stats.totalCollected,
                color: "text-white",
              },
              {
                label: "Spent",
                val: stats.totalSpent,
                color: "text-orange-400",
              },
              {
                label: "Balance",
                val: stats.remaining,
                color: "text-emerald-400",
              },
            ].map((s) => (
              <div
                key={s.label}
                className="bg-white/5 p-3 rounded-2xl border border-white/10 backdrop-blur-md"
              >
                <p className="text-[9px] font-black uppercase opacity-40 mb-1 tracking-wider">
                  {s.label}
                </p>
                <p className={`text-sm font-mono font-black ${s.color}`}>
                  ₹{s.val.toLocaleString()}
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
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
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
              {/* IMAGE UPLOAD - THE HARD CONSTRAINT */}
              <label
                className={`block w-full h-48 border-4 border-dashed rounded-[2rem] flex flex-col items-center justify-center cursor-pointer transition-all overflow-hidden relative ${
                  formImage
                    ? "border-emerald-400 bg-emerald-50/30"
                    : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                }`}
              >
                {formImage ? (
                  <img
                    src={formImage}
                    className="w-full h-full object-cover"
                    alt="Receipt Preview"
                  />
                ) : (
                  <div className="text-center p-6">
                    <div className="bg-indigo-600 text-white p-4 rounded-3xl inline-block mb-3 shadow-lg shadow-indigo-200">
                      <svg
                        className="w-8 h-8"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
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
                <input
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={handleImageUpload}
                />
                {isAnalyzing && (
                  <div className="absolute inset-0 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center">
                    <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                    <p className="mt-3 text-[10px] font-black text-indigo-600 uppercase tracking-tighter animate-pulse">
                      AI is Reading Proof...
                    </p>
                  </div>
                )}
              </label>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 mb-1.5 ml-1 block tracking-widest">
                    Expense Title
                  </label>
                  <input
                    type="text"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="What was this for?"
                    className="w-full px-5 py-4 bg-slate-100 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all font-bold text-slate-700"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-400 mb-1.5 ml-1 block tracking-widest">
                      Amount (₹)
                    </label>
                    <input
                      type="number"
                      value={formAmount}
                      onChange={(e) => setFormAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full px-5 py-4 bg-slate-100 rounded-2xl focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all font-mono font-black text-lg text-indigo-600"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase text-slate-400 mb-1.5 ml-1 block tracking-widest">
                      Category
                    </label>
                    <select
                      value={formCategory}
                      onChange={(e) =>
                        setFormCategory(e.target.value as ExpenseCategory)
                      }
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
                disabled={
                  !formImage ||
                  !formTitle ||
                  !formAmount ||
                  isUploading ||
                  isAnalyzing
                }
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
                className={`flex-shrink-0 px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${selectedCategory === "All" ? "bg-indigo-600 text-white shadow-xl" : "bg-white text-slate-400"}`}
              >
                All Items
              </button>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`flex-shrink-0 px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all ${selectedCategory === cat ? "bg-indigo-600 text-white shadow-xl" : "bg-white text-slate-400"}`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {filteredExpenses.length === 0 ? (
                <div className="text-center py-24">
                  <div className="bg-slate-200 w-20 h-20 rounded-[2rem] flex items-center justify-center mx-auto mb-6 opacity-20">
                    <svg
                      className="w-10 h-10"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
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
                filteredExpenses.map((expense) => (
                  <div
                    key={expense.id}
                    className="group bg-white p-4 rounded-[2rem] shadow-sm border border-slate-100 flex gap-4 items-center active:scale-[0.98] transition-all"
                  >
                    <div
                      className="w-16 h-16 rounded-[1.25rem] overflow-hidden flex-shrink-0 cursor-pointer border border-slate-100 shadow-inner"
                      onClick={() => setSelectedProof(expense.imageUrl)}
                    >
                      <img
                        src={expense.imageUrl}
                        className="w-full h-full object-cover"
                        alt="Proof"
                      />
                    </div>

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
                          REF: {expense.id.slice(-6).toUpperCase()}
                        </p>
                        <p className="text-lg font-black text-slate-900 font-mono">
                          ₹{expense.amount.toLocaleString()}
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
                            onClick={() => deleteExpense(expense.id)}
                            className="px-3 py-1.5 bg-red-50 text-red-600 rounded-xl text-[9px] font-black uppercase"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
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
            <svg
              className="w-8 h-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
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
        <div
          className="fixed inset-0 z-[100] bg-indigo-950/90 backdrop-blur-3xl flex items-center justify-center p-6 animate-in fade-in duration-300"
          onClick={() => setSelectedProof(null)}
        >
          <div className="relative w-full max-w-sm">
            <button className="absolute -top-12 right-0 text-white p-2">
              <svg
                className="w-8 h-8"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
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
      )}

      <footer className="py-10 text-center opacity-20 safe-bottom">
        <p className="text-[9px] font-black uppercase tracking-[0.3em]">
          Pune ➔ Ujjain Digital Ledger 2024
        </p>
      </footer>
    </div>
  );
};

export default App;
