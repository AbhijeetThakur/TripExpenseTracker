
export type ExpenseCategory = 'Food' | 'Water' | 'Transport' | 'Fine' | 'Misc' | 'Stay';

export interface Expense {
  id: string;
  title: string;
  amount: number;
  category: ExpenseCategory;
  imageUrl: string;
  timestamp: number;
  volunteerName: string;
}

export interface TripStats {
  totalCollected: number;
  totalSpent: number;
  remaining: number;
}

// Added missing interface for individual items extracted from a receipt
export interface ReceiptItem {
  id: string;
  name: string;
  price: number;
  assignedTo: string[];
}

// Added missing interface for the complete structured receipt data
export interface ReceiptData {
  items: ReceiptItem[];
  subtotal: number;
  tax: number;
  tip: number;
  total: number;
}

// Added missing interface for chat messages in the smart splitter
export interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
}

// Added missing interface for summarizing expenses per person
export interface PersonSummary {
  name: string;
  grandTotal: number;
  items: string[];
}
