
import React, { useState, useMemo, useEffect } from 'react';
import { Expense, ExpenseCategory, TripStats } from './types';
import { analyzeReceipt } from './services/geminiService';

const BUDGET_TOTAL = 500000; // Example: 5 Lakh INR Collected
const CATEGORIES: ExpenseCategory[] = ['Food', 'Water', 'Transport', 'Fine', 'Stay', 'Misc'];

const App: React.FC = () => {
  const [expenses, setExpenses] = useState<Expense[]>(() => {
    const saved = localStorage.getItem('trip_expenses');
    return saved ? JSON.parse(saved) : [];
  });
  
  const [isVolunteerMode, setIsVolunteerMode] = useState(false);
  const [isVolunteerAccess, setIsVolunteerAccess] = useState(false); // Permission toggle
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ExpenseCategory | 'All'>('All');
  const [selectedProof, setSelectedProof] = useState<string | null>(null);

  // Form State
  const [formTitle, setFormTitle] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formCategory, setFormCategory] = useState<ExpenseCategory>('Misc');
  const [formImage, setFormImage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  useEffect(() => {
    localStorage.setItem('trip_expenses', JSON.stringify(expenses));
  }, [expenses]);

  const stats = useMemo<TripStats>(() => {
    const spent = expenses.reduce((acc, curr) => acc + curr.amount, 0);
    return {
      totalCollected: BUDGET_TOTAL,
      totalSpent: spent,
      remaining: BUDGET_TOTAL - spent
    };
  }, [expenses]);

  const filteredExpenses = useMemo(() => {
    return expenses
      .filter(e => {
        const matchesSearch = e.title.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCat = selectedCategory === 'All' || e.category === selectedCategory;
        return matchesSearch && matchesCat;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [expenses, searchTerm, selectedCategory]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      setFormImage(base64);
      
      setIsAnalyzing(true);
      try {
        const data = await analyzeReceipt(base64);
        setFormTitle(data.title);
        setFormAmount(data.amount.toString());
        setFormCategory(data.category as ExpenseCategory);
      } catch (err) {
        console.error("AI Analysis failed", err);
      } finally {
        setIsAnalyzing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const saveExpense = () => {
    if (!formImage || !formTitle || !formAmount) return;

    if (editingId) {
      setExpenses(prev => prev.map(exp => exp.id === editingId ? {
        ...exp,
        title: formTitle,
        amount: parseFloat(formAmount),
        category: formCategory,
        imageUrl: formImage,
      } : exp));
      setEditingId(null);
    } else {
      const newExpense: Expense = {
        id: Date.now().toString(),
        title: formTitle,
        amount: parseFloat(formAmount),
        category: formCategory,
        imageUrl: formImage,
        timestamp: Date.now(),
        volunteerName: "Volunteer 1"
      };
      setExpenses([newExpense, ...expenses]);
    }

    // Reset Form
    resetForm();
    setIsVolunteerMode(false);
  };

  const resetForm = () => {
    setFormTitle('');
    setFormAmount('');
    setFormCategory('Misc');
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

  const deleteExpense = (id: string) => {
    if (window.confirm("Are you sure you want to delete this expense record?")) {
      setExpenses(prev => prev.filter(exp => exp.id !== id));
    }
  };

  const toggleVolunteerMode = () => {
    if (isVolunteerMode) {
      resetForm();
    }
    setIsVolunteerMode(!isVolunteerMode);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans pb-20">
      {/* Sticky Header */}
      <header className="sticky top-0 z-30 bg-indigo-900 text-white shadow-xl px-4 py-4 safe-top">
        <div className="flex justify-between items-center mb-4">
          <div className="flex flex-col">
            <h1 className="text-xl font-black tracking-tight">PUNE ➔ UJJAIN</h1>
            <label className="flex items-center gap-2 mt-1 cursor-pointer">
              <input 
                type="checkbox" 
                checked={isVolunteerAccess} 
                onChange={() => setIsVolunteerAccess(!isVolunteerAccess)}
                className="w-3 h-3 rounded text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-[9px] uppercase font-bold tracking-widest text-indigo-300">Volunteer Access</span>
            </label>
          </div>
          
          {isVolunteerAccess && (
            <button 
              onClick={toggleVolunteerMode}
              className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
                isVolunteerMode ? 'bg-red-500' : 'bg-orange-500 shadow-lg shadow-orange-900/40'
              }`}
            >
              {isVolunteerMode ? 'Cancel' : 'Add Expense'}
            </button>
          )}
        </div>
        
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-white/10 p-2 rounded-lg backdrop-blur-sm border border-white/5">
            <p className="text-[10px] opacity-60 uppercase font-bold">Collected</p>
            <p className="text-sm font-mono font-bold">₹{stats.totalCollected.toLocaleString()}</p>
          </div>
          <div className="bg-white/10 p-2 rounded-lg backdrop-blur-sm border border-white/5">
            <p className="text-[10px] opacity-60 uppercase font-bold">Spent</p>
            <p className="text-sm font-mono font-bold text-orange-300">₹{stats.totalSpent.toLocaleString()}</p>
          </div>
          <div className="bg-white/20 p-2 rounded-lg backdrop-blur-sm border border-white/10 ring-1 ring-white/20">
            <p className="text-[10px] opacity-60 uppercase font-bold">Balance</p>
            <p className="text-sm font-mono font-bold text-green-300">₹{stats.remaining.toLocaleString()}</p>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 max-w-lg mx-auto w-full">
        {isVolunteerMode ? (
          <div className="bg-white p-6 rounded-3xl shadow-2xl border border-slate-200 animate-in fade-in slide-in-from-bottom-4 duration-300">
            <h2 className="text-2xl font-black text-slate-800 mb-6">
              {editingId ? 'Update Expense' : 'Log New Expense'}
            </h2>
            
            <div className="space-y-4">
              <div className="relative">
                <label className={`block w-full h-40 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center cursor-pointer transition-all ${
                  formImage ? 'border-green-500 bg-green-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100'
                }`}>
                  {formImage ? (
                    <img src={formImage} className="w-full h-full object-cover rounded-2xl" alt="Preview" />
                  ) : (
                    <div className="text-center p-4">
                      <div className="bg-indigo-100 p-3 rounded-full inline-block mb-2">
                        <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <p className="text-sm font-bold text-slate-500 uppercase tracking-tighter">Upload Proof First *</p>
                    </div>
                  )}
                  <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                </label>
                {isAnalyzing && (
                  <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] rounded-2xl flex items-center justify-center">
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                      <p className="mt-2 text-xs font-bold text-indigo-600 animate-pulse uppercase">AI Parsing Receipt...</p>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Expense Title</label>
                <input 
                  type="text" 
                  value={formTitle} 
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="e.g. Dinner at Dhaba"
                  className="w-full px-4 py-3 bg-slate-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-medium"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Amount (INR)</label>
                  <input 
                    type="number" 
                    value={formAmount} 
                    onChange={e => setFormAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-4 py-3 bg-slate-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black uppercase text-slate-400 mb-1 block">Category</label>
                  <select 
                    value={formCategory}
                    onChange={e => setFormCategory(e.target.value as ExpenseCategory)}
                    className="w-full px-4 py-3 bg-slate-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none appearance-none font-bold"
                  >
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <button 
                onClick={saveExpense}
                disabled={!formImage || !formTitle || !formAmount}
                className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-indigo-200 disabled:bg-slate-200 disabled:shadow-none transition-all active:scale-95"
              >
                {editingId ? 'Update Record' : 'Add to Public Ledger'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Filter Bar */}
            <div className="space-y-3">
              <input 
                type="text" 
                placeholder="Search ledger..." 
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl border-none shadow-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
              />
              <div className="flex gap-2 overflow-x-auto pb-2 no-scrollbar">
                <button 
                  onClick={() => setSelectedCategory('All')}
                  className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold transition-all ${
                    selectedCategory === 'All' ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-500'
                  }`}
                >
                  All
                </button>
                {CATEGORIES.map(cat => (
                  <button 
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold transition-all ${
                      selectedCategory === cat ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-slate-500'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Ledger Feed */}
            <div className="space-y-4">
              {filteredExpenses.length === 0 ? (
                <div className="text-center py-20 opacity-30">
                  <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="font-bold">No expenses found</p>
                </div>
              ) : (
                filteredExpenses.map(expense => (
                  <div key={expense.id} className="relative bg-white p-4 rounded-3xl shadow-sm border border-slate-100 flex gap-4 items-center animate-in slide-in-from-left-2 duration-300 group">
                    <div 
                      className="w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0 cursor-pointer border border-slate-100 shadow-inner"
                      onClick={() => setSelectedProof(expense.imageUrl)}
                    >
                      <img src={expense.imageUrl} className="w-full h-full object-cover" alt="Receipt" />
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start">
                        <p className="text-[10px] font-black uppercase text-indigo-500 mb-0.5 tracking-widest">{expense.category}</p>
                        <p className="text-[10px] text-slate-400">{new Date(expense.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                      </div>
                      <h3 className="font-bold text-slate-800 truncate pr-8">{expense.title}</h3>
                      <p className="text-[10px] text-slate-400 uppercase tracking-tighter">By {expense.volunteerName}</p>
                    </div>

                    <div className="text-right flex flex-col items-end">
                      <p className="text-lg font-black text-slate-900 font-mono">₹{expense.amount.toLocaleString()}</p>
                      
                      {/* Volunteer Controls */}
                      {isVolunteerAccess && (
                        <div className="flex gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={(e) => { e.stopPropagation(); startEdit(expense); }}
                            className="p-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-indigo-50 hover:text-indigo-600"
                            title="Edit"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          <button 
                            onClick={(e) => { e.stopPropagation(); deleteExpense(expense.id); }}
                            className="p-1.5 bg-slate-100 text-slate-600 rounded-lg hover:bg-red-50 hover:text-red-600"
                            title="Delete"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
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

      {/* Proof Modal */}
      {selectedProof && (
        <div 
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex items-center justify-center p-6 animate-in fade-in duration-300"
          onClick={() => setSelectedProof(null)}
        >
          <div className="relative max-w-full max-h-full">
            <button className="absolute -top-12 right-0 text-white p-2">
              <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <img 
              src={selectedProof} 
              className="max-w-full max-h-[80vh] rounded-3xl shadow-2xl object-contain border-4 border-white/20" 
              alt="Proof Full Resolution" 
            />
            <div className="mt-4 text-center">
              <p className="text-white text-sm font-bold opacity-70">Tap anywhere to close</p>
            </div>
          </div>
        </div>
      )}
      
      {/* Footer Branding */}
      <footer className="py-8 text-center opacity-30">
        <p className="text-xs font-black uppercase tracking-widest">Digital Ledger • Pune to Ujjain 2024</p>
      </footer>
    </div>
  );
};

export default App;
