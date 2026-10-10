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

// "+91 98765 43210" / "098765-43210" -> "9876543210"; null if it isn't an Indian mobile number.
export function normalizePhone(value) {
  const phone = String(value ?? '').trim().replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(phone) ? phone : null;
}

// Price bands mirror Mehta Mart's own groupings ("Under ₹99", "Under ₹199", ...).
export const PRICE_BANDS = [
  { key: 'under-99', label: 'Under ₹99', small: 'Under', big: '₹99', max: 9900 },
  { key: 'under-199', label: 'Under ₹199', small: 'Under', big: '₹199', max: 19900 },
  { key: 'under-299', label: 'Under ₹299', small: 'Under', big: '₹299', max: 29900 },
  { key: 'under-599', label: 'Under ₹599', small: 'Under', big: '₹599', max: 59900 },
  { key: 'under-999', label: 'Under ₹999', small: 'Under', big: '₹999', max: 99900 },
  { key: '1000-plus', label: '₹1,000+', small: 'Premium', big: '₹1,000+', min: 100000 },
];
