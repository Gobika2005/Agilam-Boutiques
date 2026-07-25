import type { Guest } from '@/state/ShopContext';

/**
 * The buyer's contact/delivery details, held in memory for the current visit.
 *
 * Buyers never create an account, so this is how we remember who they are
 * across the anonymous chat identity and guest checkout: capture name + phone
 * once (the lightweight gate before chatting or ordering), reuse everywhere.
 * Not persisted — a refresh clears it and the buyer re-enters their details.
 */

export const EMPTY_GUEST: Guest = { name: '', phone: '', city: '', address: '', pincode: '' };

let guestState: Guest = EMPTY_GUEST;

export function readGuest(): Guest {
  return guestState;
}

export function writeGuest(g: Guest): void {
  guestState = g;
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
