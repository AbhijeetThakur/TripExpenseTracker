
import React, { useState, useRef, useEffect } from 'react';
import { Message, PersonSummary } from '../types';

interface ChatPaneProps {
  messages: Message[];
  onSendMessage: (text: string) => void;
  personSummaries: PersonSummary[];
  isProcessing: boolean;
  isReady: boolean;
}

const ChatPane: React.FC<ChatPaneProps> = ({ messages, onSendMessage, personSummaries, isProcessing, isReady }) => {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;
    onSendMessage(input);
    setInput('');
  };

  return (
    <div className="h-full flex flex-col bg-slate-50 border-l border-slate-200">
      <div className="p-6 bg-white border-b border-slate-200 shadow-sm flex items-center gap-3">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white">
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-800">Smart Splitter</h2>
          <p className="text-xs text-slate-500 font-medium">Chat with AI to assign items</p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-4 text-slate-400">
            <svg className="w-12 h-12 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm max-w-[240px]">
              Try saying:<br/>
              <span className="font-mono text-xs italic">"Dhruv had the nachos"</span> or <br/>
              <span className="font-mono text-xs italic">"Alex and Sam shared the pizza"</span>
            </p>
          </div>
        )}
        
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] px-4 py-3 rounded-2xl shadow-sm ${
              msg.role === 'user' 
                ? 'bg-indigo-600 text-white rounded-br-none' 
                : 'bg-white text-slate-800 border border-slate-100 rounded-bl-none'
            }`}>
              <p className="text-sm leading-relaxed">{msg.content}</p>
            </div>
          </div>
        ))}

        {isProcessing && (
          <div className="flex justify-start">
            <div className="bg-white text-slate-800 border border-slate-100 px-4 py-3 rounded-2xl shadow-sm rounded-bl-none flex gap-2">
              <div className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-bounce"></div>
              <div className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
              <div className="w-1.5 h-1.5 bg-indigo-300 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
            </div>
          </div>
        )}
      </div>

      {personSummaries.length > 0 && (
        <div className="px-6 py-4 bg-indigo-50 border-t border-indigo-100 overflow-x-auto">
          <h3 className="text-[10px] uppercase font-bold text-indigo-400 mb-3 tracking-widest">Real-time Owed Summary</h3>
          <div className="flex gap-4 pb-1">
            {personSummaries.map((summary) => (
              <div key={summary.name} className="flex-shrink-0 bg-white p-3 rounded-xl border border-indigo-100 shadow-sm min-w-[140px]">
                <p className="text-xs font-bold text-slate-400 uppercase tracking-tight">{summary.name}</p>
                <p className="text-xl font-black text-indigo-600">${summary.grandTotal.toFixed(2)}</p>
                <p className="text-[10px] text-slate-400 mt-1">{summary.items.length} items</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="p-6 bg-white border-t border-slate-200">
        <div className="relative">
          <input
            disabled={!isReady || isProcessing}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isReady ? "Assign items... (e.g., Sarah had the wings)" : "Upload a receipt first"}
            className="w-full pl-4 pr-12 py-3 bg-slate-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!isReady || isProcessing || !input.trim()}
            className="absolute right-2 top-1.5 p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-slate-300 transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
};

export default ChatPane;
