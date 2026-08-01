import { supabase } from '@/lib/supabase';
import { removePrivateFile } from '@/lib/privateUpload';

/**
 * Platform expenses (migration 0056) — the money the business spends, as
 * opposed to the money it takes. Admin-only under RLS; every read here assumes
 * an admin session.
 *
 * `proofs` holds storage PATHS inside the private `expense-proofs` bucket, not
 * URLs — see `@/lib/privateUpload` for why and for how they are opened.
 */

export const PROOF_BUCKET = 'expense-proofs';
export const EXPENSES_MIGRATION = '0056_expenses.sql';

export type ExpenseRow = {
  id: string;
  /** YYYY-MM-DD, the day the money left. */
  spent_on: string;
  category: string;
  title: string;
  vendor: string;
  amount: number;
  payment_method: string;
  reference: string;
  notes: string;
  proofs: string[];
  created_by: string | null;
  created_by_name: string;
  created_at: string;
  updated_at: string;
};

export type ExpenseInput = {
  spent_on: string;
  category: string;
  title: string;
  vendor: string;
  amount: number;
  payment_method: string;
  reference: string;
  notes: string;
  proofs: string[];
};

/**
 * The category list, owned by the app rather than a DB check constraint so a
 * new line item is a one-line change here instead of a migration. Rows carrying
 * an unknown category still render — see `categoryMeta`.
 */
export const EXPENSE_CATEGORIES: { value: string; label: string; icon: string }[] = [
  { value: 'marketing', label: 'Marketing & ads', icon: 'campaign' },
  { value: 'salaries', label: 'Salaries & contractors', icon: 'badge' },
  { value: 'software', label: 'Software & subscriptions', icon: 'cloud' },
  { value: 'infrastructure', label: 'Hosting & infrastructure', icon: 'dns' },
  { value: 'gateway', label: 'Payment gateway fees', icon: 'credit_card' },
  { value: 'logistics', label: 'Logistics & delivery', icon: 'local_shipping' },
  { value: 'office', label: 'Office & rent', icon: 'chair' },
  { value: 'equipment', label: 'Equipment & devices', icon: 'devices' },
  { value: 'legal', label: 'Legal & professional', icon: 'gavel' },
  { value: 'travel', label: 'Travel', icon: 'flight' },
  { value: 'utilities', label: 'Utilities & internet', icon: 'bolt' },
  { value: 'taxes', label: 'Taxes & compliance', icon: 'account_balance' },
  { value: 'other', label: 'Other', icon: 'more_horiz' },
];

export const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'upi', label: 'UPI' },
  { value: 'bank', label: 'Bank transfer' },
  { value: 'card', label: 'Card' },
  { value: 'cash', label: 'Cash' },
  { value: 'auto_debit', label: 'Auto-debit / mandate' },
  { value: 'other', label: 'Other' },
];

export function categoryMeta(value: string) {
  return (
    EXPENSE_CATEGORIES.find((c) => c.value === value) ?? {
      value,
      label: value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Other',
      icon: 'more_horiz',
    }
  );
}

export function paymentLabel(value: string): string {
  return PAYMENT_METHODS.find((m) => m.value === value)?.label ?? value;
}

/** Today as YYYY-MM-DD in the admin's own timezone, not UTC. */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function emptyExpenseInput(): ExpenseInput {
  return {
    spent_on: todayIso(),
    category: 'marketing',
    title: '',
    vendor: '',
    amount: 0,
    payment_method: 'upi',
    reference: '',
    notes: '',
    proofs: [],
  };
}

export function expenseInputFromRow(r: ExpenseRow): ExpenseInput {
  return {
    spent_on: r.spent_on,
    category: r.category,
    title: r.title,
    vendor: r.vendor,
    amount: r.amount,
    payment_method: r.payment_method,
    reference: r.reference,
    notes: r.notes,
    proofs: [...r.proofs],
  };
}

export type ExpenseFieldErrors = Partial<Record<'title' | 'amount' | 'spent_on', string>>;

export function validateExpenseInput(input: ExpenseInput): ExpenseFieldErrors {
  const errors: ExpenseFieldErrors = {};
  if (!input.title.trim()) errors.title = 'Say what this was for';
  if (!(input.amount > 0)) errors.amount = 'Enter an amount above ₹0';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.spent_on)) errors.spent_on = 'Pick the date it was paid';
  // A future-dated expense is a typo often enough to be worth blocking; a
  // planned spend belongs in a budget, not in the ledger of what was paid.
  else if (input.spent_on > todayIso()) errors.spent_on = "That's in the future";
  return errors;
}

const COLUMNS =
  'id, spent_on, category, title, vendor, amount, payment_method, reference, notes, proofs, created_by, created_by_name, created_at, updated_at';

/**
 * True when PostgREST rejected the query because migration 0056 has not been
 * applied yet — the console then shows a set-up message instead of a raw
 * "relation does not exist".
 */
export function isMissingExpensesTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '42P01' || /relation .*expenses.* does not exist/i.test(error.message ?? '');
}

export class ExpensesNotSetUpError extends Error {
  constructor() {
    super(`Expense tracking is not set up yet — apply migration ${EXPENSES_MIGRATION} in Supabase`);
    this.name = 'ExpensesNotSetUpError';
  }
}

export async function fetchExpenses(limit = 500): Promise<ExpenseRow[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select(COLUMNS)
    .order('spent_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingExpensesTable(error)) throw new ExpensesNotSetUpError();
    throw error;
  }
  return (data ?? []).map((r) => ({ ...(r as ExpenseRow), amount: Number((r as ExpenseRow).amount) }));
}

export async function createExpense(
  input: ExpenseInput,
  author: { id?: string | null; name?: string },
): Promise<void> {
  const { error } = await supabase.from('expenses').insert({
    ...normalise(input),
    created_by: author.id ?? null,
    created_by_name: author.name ?? 'Admin',
  });
  if (error) {
    if (isMissingExpensesTable(error)) throw new ExpensesNotSetUpError();
    throw error;
  }
}

export async function updateExpense(id: string, input: ExpenseInput): Promise<void> {
  const { error } = await supabase.from('expenses').update(normalise(input)).eq('id', id);
  if (error) throw error;
}

/**
 * Deletes the row and then its receipts. The row goes first: an orphaned file
 * costs a few kilobytes, whereas a row pointing at deleted proof is a ledger
 * entry nobody can verify.
 */
export async function deleteExpense(row: ExpenseRow): Promise<void> {
  const { error } = await supabase.from('expenses').delete().eq('id', row.id);
  if (error) throw error;
  await Promise.all(row.proofs.map((p) => removePrivateFile(PROOF_BUCKET, p)));
}

function normalise(input: ExpenseInput) {
  return {
    spent_on: input.spent_on,
    category: input.category,
    title: input.title.trim(),
    vendor: input.vendor.trim(),
    amount: Math.round(input.amount * 100) / 100,
    payment_method: input.payment_method,
    reference: input.reference.trim(),
    notes: input.notes.trim(),
    proofs: input.proofs,
  };
}

// ── Aggregates the page's stat cards run on ──────────────────────────────────

export type ExpenseTotals = {
  total: number;
  thisMonth: number;
  lastMonth: number;
  count: number;
  missingProof: number;
  byCategory: { value: string; label: string; amount: number; pct: number }[];
};

/** YYYY-MM of a spent_on date, compared as a string — no timezone to get wrong. */
export const monthKey = (iso: string) => iso.slice(0, 7);

export function summariseExpenses(rows: ExpenseRow[]): ExpenseTotals {
  const now = new Date();
  const thisKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevKey = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;

  const total = rows.reduce((s, r) => s + r.amount, 0);
  const byCat = new Map<string, number>();
  rows.forEach((r) => byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.amount));

  return {
    total,
    thisMonth: rows.filter((r) => monthKey(r.spent_on) === thisKey).reduce((s, r) => s + r.amount, 0),
    lastMonth: rows.filter((r) => monthKey(r.spent_on) === prevKey).reduce((s, r) => s + r.amount, 0),
    count: rows.length,
    missingProof: rows.filter((r) => r.proofs.length === 0).length,
    byCategory: [...byCat.entries()]
      .map(([value, amount]) => ({ value, label: categoryMeta(value).label, amount, pct: total ? (amount / total) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount),
  };
}

/** The last 12 month buckets, oldest first — the trend bars on the stat card. */
export function monthlyBars(rows: ExpenseRow[], months = 12): number[] {
  const now = new Date();
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys.map((k) => rows.filter((r) => monthKey(r.spent_on) === k).reduce((s, r) => s + r.amount, 0));
}

/** Distinct months present in the data, newest first — drives the period filter. */
export function availableMonths(rows: ExpenseRow[]): string[] {
  return [...new Set(rows.map((r) => monthKey(r.spent_on)))].sort().reverse();
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** CSV of the rows currently on screen, for the accountant who wants a file. */
export function expensesToCsv(rows: ExpenseRow[]): string {
  const head = ['Date', 'Category', 'What for', 'Paid to', 'Amount (INR)', 'Method', 'Reference', 'Proofs', 'Filed by', 'Notes'];
  const cell = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [r.spent_on, categoryMeta(r.category).label, r.title, r.vendor, r.amount.toFixed(2), paymentLabel(r.payment_method), r.reference, r.proofs.length, r.created_by_name, r.notes]
      .map(cell)
      .join(','),
  );
  return [head.join(','), ...lines].join('\n');
}
