import type { Guest } from '@/state/ShopContext';

/**
 * The buyer's saved contact/delivery details, persisted to localStorage.
 *
 * Buyers never create an account, so this is how we remember who they are
 * across the anonymous chat identity and guest checkout: capture name + phone
 * once (the lightweight gate before chatting or ordering), reuse everywhere.
 */

const KEY = 'agx-guest';

export const EMPTY_GUEST: Guest = { name: '', phone: '', city: '', address: '', pincode: '' };

export function readGuest(): Guest {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...EMPTY_GUEST, ...(JSON.parse(raw) as Partial<Guest>) };
  } catch {
    /* storage unavailable or corrupt — fall through to empty */
  }
  return EMPTY_GUEST;
}

export function writeGuest(g: Guest): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(g));
  } catch {
    /* storage unavailable — in-memory state still covers this session */
  }
}

/** Indian 10-digit mobile number. */
export function phoneOk(phone: string): boolean {
  return /^\d{10}$/.test(phone.trim());
}

export function nameOk(name: string): boolean {
  return name.trim().length >= 2;
}

/** Indian 6-digit PIN code (first digit 1–9). */
export function pincodeOk(pincode: string): boolean {
  return /^[1-9]\d{5}$/.test(pincode.trim());
}

/** The minimum needed to start a chat or place an order: a name and a phone. */
export function hasContactDetails(g: Guest): boolean {
  return nameOk(g.name) && phoneOk(g.phone);
}

/** Everything checkout needs to ship an order. */
export function hasDeliveryDetails(g: Guest): boolean {
  return (
    hasContactDetails(g) &&
    g.address.trim().length >= 5 &&
    g.city.trim().length >= 2 &&
    pincodeOk(g.pincode)
  );
}
