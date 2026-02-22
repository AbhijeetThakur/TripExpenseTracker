import React, { useEffect, useMemo, useState } from "react";
import { GoogleGenAI, Type } from "@google/genai";
import { initializeApp } from "firebase/app";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore/lite";

type ExpenseCategory = "Food" | "Water" | "Transport" | "Fine" | "Stay" | "Misc";

interface ExpenseRecord {
  id: string;
  title: string;
  amount: number;
  category: ExpenseCategory;
  receiptBase64: string | null;
  timestamp: number;
  updatedAt?: number;
  volunteerName: string;
}

interface LedgerSettings {
  budgetTotal: number;
  volunteerPasswords: Record<string, string>;
}

type SessionRole = "public" | "volunteer" | "admin";

interface AuthSession {
  role: SessionRole;
  volunteerName?: string;
}

const CATEGORIES: ExpenseCategory[] = ["Food", "Water", "Transport", "Fine", "Stay", "Misc"];
const DEFAULT_VOLUNTEER_PASSWORD = "Ujjain@2024";
const DEFAULT_ADMIN_PASSWORD = "Admin@2024";

const EXPENSES_STORAGE_KEY = "trip_expenses";
const SETTINGS_STORAGE_KEY = "trip_ledger_settings";
const AUTH_STORAGE_KEY = "trip_auth_session";

const env = import.meta.env ?? {};

function cleanEnvValue(v: unknown): string | undefined {
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
const ADMIN_PASSWORD = cleanEnvValue(env.VITE_ADMIN_PASSWORD ?? env.ADMIN_PASSWORD) ?? DEFAULT_ADMIN_PASSWORD;

const firebaseConfig = {
  apiKey: FB_API_KEY,
  projectId: FB_PROJECT_ID,
  appId: FB_APP_ID,
  authDomain: FB_AUTH_DOMAIN ?? (FB_PROJECT_ID ? `${FB_PROJECT_ID}.firebaseapp.com` : undefined),
};

const hasFirebase = Boolean(FB_API_KEY && FB_PROJECT_ID && FB_APP_ID);
let db: ReturnType<typeof getFirestore> | null = null;
if (hasFirebase) {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
}

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

function estimateDataUrlBytes(dataUrl: string | null): number {
  if (!dataUrl || typeof dataUrl !== "string") return 0;
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return 0;
  const b64 = dataUrl.slice(comma + 1);
  let padding = 0;
  if (b64.endsWith("==")) padding = 2;
  else if (b64.endsWith("=")) padding = 1;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image blob."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(blob);
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("Canvas encoding failed."));
      },
      "image/jpeg",
      quality,
    );
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms / 1000}s. Check internet/Firebase config.`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
  });
}

async function compressImageToJpegDataUrl(
  file: File,
  { maxWidth = 800, quality = 0.7 }: { maxWidth?: number; quality?: number },
): Promise<string> {
  let source: ImageBitmap | HTMLImageElement | null = null;
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
      await new Promise<void>((resolve, reject) => {
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

  if (shouldClose && source && "close" in source && typeof source.close === "function") {
    source.close();
  }

  const blob = await canvasToJpegBlob(canvas, quality);
  return blobToDataUrl(blob);
}

function normalizeCategory(value: unknown): ExpenseCategory {
  const category = String(value ?? "Misc");
  return CATEGORIES.includes(category as ExpenseCategory) ? (category as ExpenseCategory) : "Misc";
}

function normalizeExpense(id: string, raw: unknown): ExpenseRecord {
  const data = (raw ?? {}) as Partial<ExpenseRecord> & { imageUrl?: string };
  return {
    id,
    title: String(data.title ?? ""),
    amount: Number(data.amount ?? 0),
    category: normalizeCategory(data.category),
    receiptBase64: (data.receiptBase64 ?? data.imageUrl ?? null) as string | null,
    timestamp: Number(data.timestamp ?? Date.now()),
    updatedAt: data.updatedAt ? Number(data.updatedAt) : undefined,
    volunteerName: String(data.volunteerName ?? "Volunteer"),
  };
}

function sortByLatest(a: ExpenseRecord, b: ExpenseRecord): number {
  return Number(b.timestamp || 0) - Number(a.timestamp || 0);
}

function readStoredSettings(): LedgerSettings {
  const fallback: LedgerSettings = {
    budgetTotal: 500000,
    volunteerPasswords: { Volunteer: DEFAULT_VOLUNTEER_PASSWORD },
  };
  const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<LedgerSettings>;
    return {
      budgetTotal: Number(parsed.budgetTotal ?? fallback.budgetTotal),
      volunteerPasswords:
        parsed.volunteerPasswords && typeof parsed.volunteerPasswords === "object"
          ? parsed.volunteerPasswords
          : fallback.volunteerPasswords,
    };
  } catch {
    return fallback;
  }
}

function readStoredSession(): AuthSession {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return { role: "public" };
  try {
    const parsed = JSON.parse(raw) as Partial<AuthSession>;
    if (parsed.role === "volunteer" || parsed.role === "admin") {
      return { role: parsed.role, volunteerName: parsed.volunteerName };
    }
    return { role: "public" };
  } catch {
    return { role: "public" };
  }
}

function persistSession(session: AuthSession): void {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export default function App() {
  const [expenses, setExpenses] = useState<ExpenseRecord[]>([]);
  const [settings, setSettings] = useState<LedgerSettings>(readStoredSettings);
  const [session, setSession] = useState<AuthSession>(readStoredSession);

  const [selectedCategory, setSelectedCategory] = useState<"All" | ExpenseCategory>("All");
  const [selectedProof, setSelectedProof] = useState<string | null>(null);

  const [isVolunteerMode, setIsVolunteerMode] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [formTitle, setFormTitle] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formCategory, setFormCategory] = useState<ExpenseCategory>("Misc");
  const [formImage, setFormImage] = useState<string | null>(null);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authRole, setAuthRole] = useState<"volunteer" | "admin">("volunteer");
  const [loginVolunteerName, setLoginVolunteerName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [budgetInput, setBudgetInput] = useState("");
  const [newVolunteerName, setNewVolunteerName] = useState("");
  const [newVolunteerPassword, setNewVolunteerPassword] = useState("");
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const isVolunteerAccess = session.role === "volunteer" || session.role === "admin";
  const isAdmin = session.role === "admin";

  useEffect(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      try {
        if (hasFirebase && db) {
          const expensesQuery = query(collection(db, "expenses"), orderBy("timestamp", "desc"));
          const [expensesSnap, settingsSnap] = await Promise.all([
            withTimeout(getDocs(expensesQuery), 20000, "Fetch expenses"),
            withTimeout(getDoc(doc(db, "app_settings", "ledger")), 15000, "Fetch settings"),
          ]);
          if (cancelled) return;
          const mapped = expensesSnap.docs
            .map((d) => normalizeExpense(d.id, d.data()))
            .sort(sortByLatest);
          setExpenses(mapped);
          if (settingsSnap.exists()) {
            const remote = settingsSnap.data() as Partial<LedgerSettings>;
            const merged: LedgerSettings = {
              budgetTotal: Number(remote.budgetTotal ?? 500000),
              volunteerPasswords:
                remote.volunteerPasswords && typeof remote.volunteerPasswords === "object"
                  ? remote.volunteerPasswords
                  : { Volunteer: DEFAULT_VOLUNTEER_PASSWORD },
            };
            setSettings(merged);
          }
          return;
        }

        const storedExpenses = localStorage.getItem(EXPENSES_STORAGE_KEY);
        if (!storedExpenses) return;
        const parsed = JSON.parse(storedExpenses) as Array<Partial<ExpenseRecord>>;
        const normalized = parsed
          .map((e) => normalizeExpense(String(e.id ?? Date.now()), e))
          .sort(sortByLatest);
        setExpenses(normalized);
      } catch (err) {
        console.error("Failed to load initial data", err);
        const message = err instanceof Error ? err.message : String(err);
        alert(`Failed to load data: ${message}`);
      }
    }
    void loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    const totalSpent = expenses.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    return {
      totalCollected: Number(settings.budgetTotal || 0),
      totalSpent,
      remaining: Number(settings.budgetTotal || 0) - totalSpent,
    };
  }, [expenses, settings.budgetTotal]);

  const filteredExpenses = useMemo(() => {
    if (selectedCategory === "All") return expenses;
    return expenses.filter((e) => e.category === selectedCategory);
  }, [expenses, selectedCategory]);

  const resetForm = () => {
    setFormTitle("");
    setFormAmount("");
    setFormCategory("Misc");
    setFormImage(null);
    setEditingId(null);
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    (async () => {
      setIsAnalyzing(true);
      try {
        const compressed = await compressImageToJpegDataUrl(file, { maxWidth: 800, quality: 0.7 });
        const approxBytes = estimateDataUrlBytes(compressed);
        if (approxBytes > 950_000) {
          alert("Image is too large after compression. Please crop or retake the receipt.");
          setFormImage(null);
          return;
        }

        setFormImage(compressed);
        if (!ai) return;

        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
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

        const data = JSON.parse(response.text ?? "{}") as {
          title?: string;
          amount?: number;
          category?: string;
        };
        setFormTitle(data.title ?? "");
        setFormAmount(data.amount === undefined ? "" : String(data.amount));
        if (data.category && CATEGORIES.includes(data.category as ExpenseCategory)) {
          setFormCategory(data.category as ExpenseCategory);
        }
      } catch (err) {
        console.error("Image processing / AI analysis failed", err);
      } finally {
        setIsAnalyzing(false);
      }
    })();
  };

  const applyLocalExpenses = (next: ExpenseRecord[]) => {
    const sorted = [...next].sort(sortByLatest);
    setExpenses(sorted);
    localStorage.setItem(EXPENSES_STORAGE_KEY, JSON.stringify(sorted));
  };

  const saveExpense = async () => {
    if (!isVolunteerAccess) {
      alert("Login as Volunteer/Admin first.");
      return;
    }
    if (!formImage || !formTitle || !formAmount) return;

    setIsUploading(true);
    try {
      const editor = session.role === "volunteer" ? session.volunteerName || "Volunteer" : "Admin";
      const existing = editingId ? expenses.find((e) => e.id === editingId) : undefined;
      const expenseData: Omit<ExpenseRecord, "id"> = {
        title: formTitle.trim(),
        amount: Number.parseFloat(formAmount),
        category: formCategory,
        receiptBase64: formImage,
        timestamp: existing?.timestamp ?? Date.now(),
        updatedAt: existing ? Date.now() : undefined,
        volunteerName: existing?.volunteerName || editor,
      };

      if (editingId) {
        if (hasFirebase && db) {
          await withTimeout(updateDoc(doc(db, "expenses", editingId), expenseData), 45000, "Update expense");
        }
        applyLocalExpenses(
          expenses.map((ex) => (ex.id === editingId ? { ...ex, ...expenseData, id: editingId } : ex)),
        );
      } else if (hasFirebase && db) {
        const docRef = await withTimeout(addDoc(collection(db, "expenses"), expenseData), 45000, "Save expense");
        applyLocalExpenses([{ ...expenseData, id: docRef.id }, ...expenses]);
      } else {
        applyLocalExpenses([{ ...expenseData, id: Date.now().toString() }, ...expenses]);
      }

      resetForm();
      setIsVolunteerMode(false);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : String(err);
      alert(`Error saving expense: ${message}`);
    } finally {
      setIsUploading(false);
    }
  };

  const startEdit = (expense: ExpenseRecord) => {
    setEditingId(expense.id);
    setFormTitle(expense.title || "");
    setFormAmount(String(expense.amount ?? ""));
    setFormCategory(expense.category || "Misc");
    setFormImage(expense.receiptBase64 || null);
    setIsVolunteerMode(true);
  };

  const deleteExpenseById = async (id: string) => {
    if (!isVolunteerAccess) return;
    if (!globalThis.confirm("Delete this record permanently?")) return;
    try {
      if (hasFirebase && db) {
        await withTimeout(deleteDoc(doc(db, "expenses", id)), 45000, "Delete expense");
      }
      applyLocalExpenses(expenses.filter((ex) => ex.id !== id));
    } catch (err) {
      console.error(err);
      const message = err instanceof Error ? err.message : String(err);
      alert(`Error deleting expense: ${message}`);
    }
  };

  const handleLoginSubmit = () => {
    if (authRole === "admin") {
      if (loginPassword !== ADMIN_PASSWORD) {
        alert("Incorrect admin password.");
        return;
      }
      const next = { role: "admin" as const };
      setSession(next);
      persistSession(next);
      setShowAuthModal(false);
      setLoginPassword("");
      return;
    }

    const name = loginVolunteerName.trim();
    if (!name) {
      alert("Please enter volunteer name.");
      return;
    }
    const expectedPassword = settings.volunteerPasswords[name];
    if (!expectedPassword || expectedPassword !== loginPassword) {
      alert("Invalid volunteer name/password.");
      return;
    }

    const next = { role: "volunteer" as const, volunteerName: name };
    setSession(next);
    persistSession(next);
    setShowAuthModal(false);
    setLoginPassword("");
    setLoginVolunteerName("");
  };

  const handleLogout = () => {
    setSession({ role: "public" });
    persistSession({ role: "public" });
    setIsVolunteerMode(false);
    setIsAdminPanelOpen(false);
    resetForm();
  };

  const saveSettings = async (next: LedgerSettings) => {
    setIsSavingSettings(true);
    try {
      if (hasFirebase && db) {
        await withTimeout(setDoc(doc(db, "app_settings", "ledger"), next, { merge: true }), 30000, "Save settings");
      }
      setSettings(next);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      alert(`Failed to save settings: ${message}`);
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleSaveBudget = () => {
    const value = Number(budgetInput);
    if (!Number.isFinite(value) || value < 0) {
      alert("Enter a valid collected fund amount.");
      return;
    }
    void saveSettings({ ...settings, budgetTotal: value });
  };

  const handleUpsertVolunteer = () => {
    const name = newVolunteerName.trim();
    const pw = newVolunteerPassword.trim();
    if (!name || !pw) {
      alert("Enter volunteer name and password.");
      return;
    }
    const next: LedgerSettings = {
      ...settings,
      volunteerPasswords: {
        ...settings.volunteerPasswords,
        [name]: pw,
      },
    };
    void saveSettings(next);
    setNewVolunteerName("");
    setNewVolunteerPassword("");
  };

  const handleDeleteVolunteer = (name: string) => {
    if (!globalThis.confirm(`Remove volunteer "${name}"?`)) return;
    const nextMap = { ...settings.volunteerPasswords };
    delete nextMap[name];
    const next: LedgerSettings = { ...settings, volunteerPasswords: nextMap };
    void saveSettings(next);
  };

  let saveButtonLabel = "Post to Ledger";
  if (isUploading) saveButtonLabel = "Saving...";
  else if (editingId) saveButtonLabel = "Update Record";
  const authChipLabel = session.role === "public" ? "Login" : `${session.role}: ON`;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col pb-20 select-none">
      <header className="sticky top-0 z-40 bg-indigo-950 text-white shadow-2xl safe-top">
        <div className="px-5 py-4">
          <div className="flex justify-between items-center mb-5 gap-3">
            <div>
              <h1 className="text-xl font-black tracking-tighter flex items-center gap-2">
                <span className="bg-orange-500 w-2 h-6 rounded-full" />
                <span>EXPENSE LEDGER</span>
              </h1>
              <p className="text-[10px] font-bold opacity-40 uppercase tracking-[0.2em]">
                Pune to Ujjain Journey
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAuthModal(true)}
                className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white/10"
              >
                {authChipLabel}
              </button>
              {session.role !== "public" && (
                <button
                  onClick={handleLogout}
                  className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-red-500/80"
                >
                  Logout
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Collected", val: stats.totalCollected, color: "text-white" },
              { label: "Spent", val: stats.totalSpent, color: "text-orange-400" },
              { label: "Balance", val: stats.remaining, color: "text-emerald-400" },
            ].map((s) => (
              <div key={s.label} className="bg-white/5 p-3 rounded-2xl border border-white/10 backdrop-blur-md">
                <p className="text-[9px] font-black uppercase opacity-40 mb-1 tracking-wider">{s.label}</p>
                <p className={`text-sm font-mono font-black ${s.color}`}>₹{Number(s.val || 0).toLocaleString()}</p>
              </div>
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 p-5 max-w-lg mx-auto w-full space-y-5">
        {isAdmin && (
          <div className="bg-white rounded-3xl border border-slate-200 p-4">
            <button
              onClick={() => {
                setBudgetInput(String(settings.budgetTotal));
                setIsAdminPanelOpen((prev) => !prev);
              }}
              className="w-full text-left text-sm font-black text-indigo-700"
            >
              {isAdminPanelOpen ? "Hide Admin Controls" : "Open Admin Controls"}
            </button>

            {isAdminPanelOpen && (
              <div className="mt-4 space-y-4">
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <input
                    type="number"
                    value={budgetInput}
                    onChange={(e) => setBudgetInput(e.target.value)}
                    placeholder="Collected fund"
                    className="px-4 py-3 rounded-xl bg-slate-100"
                  />
                  <button
                    onClick={handleSaveBudget}
                    disabled={isSavingSettings}
                    className="px-4 py-3 rounded-xl bg-indigo-600 text-white text-xs font-black uppercase"
                  >
                    Save
                  </button>
                </div>

                <div className="p-3 bg-slate-50 rounded-2xl">
                  <p className="text-[10px] font-black uppercase text-slate-500 mb-2">Volunteer Passwords</p>
                  <div className="space-y-2 mb-3">
                    {Object.entries(settings.volunteerPasswords).map(([name, password]) => (
                      <div key={name} className="flex items-center justify-between bg-white rounded-xl px-3 py-2">
                        <p className="text-xs font-bold text-slate-700">
                          {name} <span className="text-slate-400">({password})</span>
                        </p>
                        <button
                          onClick={() => handleDeleteVolunteer(name)}
                          className="text-[10px] text-red-500 font-black uppercase"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <input
                      value={newVolunteerName}
                      onChange={(e) => setNewVolunteerName(e.target.value)}
                      placeholder="Volunteer name"
                      className="px-3 py-2 rounded-xl bg-white"
                    />
                    <input
                      value={newVolunteerPassword}
                      onChange={(e) => setNewVolunteerPassword(e.target.value)}
                      placeholder="Volunteer password"
                      className="px-3 py-2 rounded-xl bg-white"
                    />
                    <button
                      onClick={handleUpsertVolunteer}
                      disabled={isSavingSettings}
                      className="px-4 py-3 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase"
                    >
                      Add / Update Volunteer
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {isVolunteerMode ? (
          <div className="bg-white p-6 rounded-[2.5rem] shadow-2xl border border-slate-200">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-black text-slate-800">{editingId ? "Update Record" : "Log Expense"}</h2>
              <button
                onClick={() => {
                  setIsVolunteerMode(false);
                  resetForm();
                }}
                className="p-2 bg-slate-100 rounded-full text-slate-400"
              >
                ✕
              </button>
            </div>

            <div className="space-y-5">
              <label
                className={`block w-full h-48 border-4 border-dashed rounded-[2rem] flex flex-col items-center justify-center cursor-pointer transition-all overflow-hidden relative ${
                  formImage ? "border-emerald-400 bg-emerald-50/30" : "border-slate-200 bg-slate-50 hover:bg-slate-100"
                }`}
              >
                {formImage ? (
                  <img src={formImage} className="w-full h-full object-cover" alt="Receipt Preview" />
                ) : (
                  <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Capture Proof (Required)</p>
                )}
                <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                {isAnalyzing && (
                  <div className="absolute inset-0 bg-white/80 flex flex-col items-center justify-center">
                    <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                    <p className="mt-3 text-[10px] font-black text-indigo-600 uppercase">Processing Proof...</p>
                  </div>
                )}
              </label>

              <input
                type="text"
                value={formTitle}
                onChange={(ev) => setFormTitle(ev.target.value)}
                placeholder="Expense title"
                className="w-full px-5 py-4 bg-slate-100 rounded-2xl font-bold"
              />
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="number"
                  value={formAmount}
                  onChange={(ev) => setFormAmount(ev.target.value)}
                  placeholder="0.00"
                  className="w-full px-5 py-4 bg-slate-100 rounded-2xl font-mono font-black text-lg text-indigo-600"
                />
                <select
                  value={formCategory}
                  onChange={(ev) => setFormCategory(normalizeCategory(ev.target.value))}
                  className="w-full px-5 py-4 bg-slate-100 rounded-2xl font-bold"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={saveExpense}
                disabled={!formImage || !formTitle || !formAmount || isUploading || isAnalyzing}
                className="w-full bg-indigo-600 text-white py-5 rounded-[1.5rem] font-black text-lg disabled:opacity-20"
              >
                {saveButtonLabel}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
              <button
                onClick={() => setSelectedCategory("All")}
                className={`flex-shrink-0 px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest ${
                  selectedCategory === "All" ? "bg-indigo-600 text-white" : "bg-white text-slate-400"
                }`}
              >
                All Items
              </button>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`flex-shrink-0 px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest ${
                    selectedCategory === cat ? "bg-indigo-600 text-white" : "bg-white text-slate-400"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {filteredExpenses.length === 0 ? (
                <div className="text-center py-24">
                  <p className="text-slate-400 font-bold uppercase text-[10px] tracking-widest">
                    No transactions logged
                  </p>
                </div>
              ) : (
                filteredExpenses.map((expense) => (
                  <div
                    key={expense.id}
                    className="group bg-white p-4 rounded-[2rem] shadow-sm border border-slate-100 flex gap-4 items-center"
                  >
                    <button
                      type="button"
                      className="w-16 h-16 rounded-[1.25rem] overflow-hidden flex-shrink-0 cursor-pointer border border-slate-100"
                      onClick={() => expense.receiptBase64 && setSelectedProof(expense.receiptBase64)}
                    >
                      {expense.receiptBase64 ? (
                        <img src={expense.receiptBase64} className="w-full h-full object-cover" alt="Proof" />
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
                          {new Date(expense.timestamp).toLocaleDateString()}{" "}
                          {new Date(expense.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <h3 className="font-bold text-slate-800 text-sm truncate pr-4">{expense.title}</h3>
                      <div className="flex justify-between items-end mt-1">
                        <p className="text-[10px] text-slate-500 font-bold truncate">
                          By: {expense.volunteerName || "Volunteer"}
                        </p>
                        <p className="text-lg font-black text-slate-900 font-mono">₹{Number(expense.amount || 0).toLocaleString()}</p>
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
                ))
              )}
            </div>
          </div>
        )}
      </main>

      {isVolunteerAccess && !isVolunteerMode && (
        <div className="fixed bottom-6 right-6 z-50">
          <button
            onClick={() => setIsVolunteerMode(true)}
            className="w-16 h-16 bg-orange-500 text-white rounded-[1.5rem] shadow-2xl flex items-center justify-center border-4 border-white"
          >
            +
          </button>
        </div>
      )}

      {selectedProof && (
        <div className="fixed inset-0 z-[100] bg-indigo-950/90 backdrop-blur-3xl p-6">
          <button
            type="button"
            aria-label="Close proof"
            className="absolute inset-0 z-0 w-full h-full"
            onClick={() => setSelectedProof(null)}
            onKeyDown={(ev) => {
              if (ev.key === "Escape") setSelectedProof(null);
            }}
          />
          <div className="relative z-10 w-full h-full flex items-center justify-center pointer-events-none">
            <div className="relative w-full max-w-sm pointer-events-auto">
              <div className="bg-white p-2 rounded-[2.5rem] shadow-2xl overflow-hidden">
                <img src={selectedProof} className="w-full h-auto rounded-[2rem]" alt="Proof Enlarged" />
              </div>
            </div>
          </div>
        </div>
      )}

      {showAuthModal && (
        <div className="fixed inset-0 z-[120] bg-black/40 p-5 flex items-center justify-center">
          <div className="w-full max-w-sm bg-white rounded-3xl p-5 space-y-4">
            <div className="flex gap-2">
              <button
                onClick={() => setAuthRole("volunteer")}
                className={`px-3 py-2 rounded-xl text-xs font-black uppercase ${
                  authRole === "volunteer" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"
                }`}
              >
                Volunteer
              </button>
              <button
                onClick={() => setAuthRole("admin")}
                className={`px-3 py-2 rounded-xl text-xs font-black uppercase ${
                  authRole === "admin" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-500"
                }`}
              >
                Admin
              </button>
            </div>
            {authRole === "volunteer" && (
              <input
                value={loginVolunteerName}
                onChange={(e) => setLoginVolunteerName(e.target.value)}
                placeholder="Volunteer name"
                className="w-full px-4 py-3 rounded-xl bg-slate-100"
              />
            )}
            <input
              type="password"
              value={loginPassword}
              onChange={(e) => setLoginPassword(e.target.value)}
              placeholder={authRole === "admin" ? "Admin password" : "Volunteer password"}
              className="w-full px-4 py-3 rounded-xl bg-slate-100"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowAuthModal(false);
                  setLoginPassword("");
                }}
                className="flex-1 px-4 py-3 rounded-xl bg-slate-100 text-slate-700 text-xs font-black uppercase"
              >
                Cancel
              </button>
              <button
                onClick={handleLoginSubmit}
                className="flex-1 px-4 py-3 rounded-xl bg-indigo-600 text-white text-xs font-black uppercase"
              >
                Login
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

