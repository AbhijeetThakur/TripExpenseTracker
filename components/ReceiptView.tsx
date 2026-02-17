
import React from 'react';
import { ReceiptData, ReceiptItem } from '../types';

interface ReceiptViewProps {
  data: ReceiptData | null;
  loading: boolean;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveAssignment: (itemId: string, name: string) => void;
}

const ReceiptView: React.FC<ReceiptViewProps> = ({ data, loading, onFileUpload, onRemoveAssignment }) => {
  if (loading) {
    return (
      <div className="h-full flex flex-col items-center justify-center space-y-4 p-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
        <p className="text-slate-600 animate-pulse font-medium">Reading receipt data with Gemini AI...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-6">
        <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600">
          <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Upload a Receipt</h2>
          <p className="text-slate-500 mt-2">Let our AI extract the items and totals for you automatically.</p>
        </div>
        <label className="cursor-pointer bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-semibold shadow-lg shadow-indigo-200 transition-all">
          Select Receipt Image
          <input type="file" className="hidden" accept="image/*" onChange={onFileUpload} />
        </label>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col p-6 bg-white overflow-y-auto">
      <div className="flex justify-between items-end mb-6 border-b border-slate-100 pb-4">
        <div>
          <h2 className="text-sm font-bold text-indigo-600 uppercase tracking-wider">Receipt Overview</h2>
          <h1 className="text-2xl font-black text-slate-900">Items & Breakdown</h1>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400">Grand Total</p>
          <p className="text-xl font-bold text-slate-900">${data.total.toFixed(2)}</p>
        </div>
      </div>

      <div className="space-y-4 mb-8">
        {data.items.map((item) => (
          <div key={item.id} className="group p-4 rounded-xl border border-slate-100 hover:border-indigo-100 transition-all bg-slate-50/50">
            <div className="flex justify-between items-start">
              <div className="flex-1">
                <p className="font-semibold text-slate-800">{item.name}</p>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {item.assignedTo.length === 0 ? (
                    <span className="text-[10px] uppercase font-bold tracking-tight text-slate-400 bg-white px-2 py-0.5 rounded border border-slate-100">
                      Unassigned
                    </span>
                  ) : (
                    item.assignedTo.map((name) => (
                      <span 
                        key={name} 
                        className="text-[10px] uppercase font-bold tracking-tight text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 flex items-center gap-1 group/chip cursor-pointer"
                        onClick={() => onRemoveAssignment(item.id, name)}
                      >
                        {name}
                        <span className="opacity-0 group-hover/chip:opacity-100 transition-opacity">✕</span>
                      </span>
                    ))
                  )}
                </div>
              </div>
              <p className="font-mono font-medium text-slate-700 ml-4">${item.price.toFixed(2)}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto border-t border-slate-100 pt-4 space-y-2">
        <div className="flex justify-between text-sm text-slate-500">
          <span>Subtotal</span>
          <span className="font-mono">${data.subtotal.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm text-slate-500">
          <span>Tax</span>
          <span className="font-mono">${data.tax.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-sm text-slate-500">
          <span>Tip</span>
          <span className="font-mono">${data.tip.toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-lg font-bold text-slate-900 pt-2 border-t border-slate-50">
          <span>Total</span>
          <span className="font-mono">${data.total.toFixed(2)}</span>
        </div>
      </div>
    </div>
  );
};

export default ReceiptView;
