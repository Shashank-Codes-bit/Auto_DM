export class ValidationError extends Error {}

export const slugify = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

// "499" / "499.5" / "1,299.00" -> paise. Empty -> null.
export function parseRupees(value, field = 'Price') {
  const s = String(value ?? '').replace(/[,₹\s]/g, '');
  if (s === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new ValidationError(`${field} must be a number like 499 or 499.50`);
  return Math.round(Number(s) * 100);
}

export function formatMoney(paise) {
  const rupees = (paise ?? 0) / 100;
  return '₹' + rupees.toLocaleString('en-IN', {
    minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export const paiseToInput = (paise) => (paise == null ? '' : String(paise / 100));

export const discountPercent = (price, mrp) => (mrp && mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0);
