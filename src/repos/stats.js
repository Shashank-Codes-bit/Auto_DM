const PAID = `('paid', 'shipped', 'delivered')`;

export function statsRepo(db) {
  return {
    async dashboard() {
      const [s] = await db.query(`
        SELECT
          (SELECT count(*)::int FROM activity WHERE result = 'sent') AS dms,
          (SELECT count(*)::int FROM activity WHERE result = 'sent' AND created_at >= date_trunc('day', now())) AS dms_today,
          (SELECT count(*)::int FROM visits) AS visits,
          (SELECT count(*)::int FROM visits WHERE created_at >= date_trunc('day', now())) AS visits_today,
          (SELECT count(*)::int FROM orders WHERE status <> 'cancelled') AS orders,
          (SELECT count(*)::int FROM orders WHERE status <> 'cancelled' AND created_at >= date_trunc('day', now())) AS orders_today,
          (SELECT coalesce(sum(total_paise), 0)::bigint FROM orders WHERE status IN ${PAID}) AS revenue,
          (SELECT count(*)::int FROM orders WHERE status IN ('awaiting_payment', 'payment_submitted')) AS to_confirm,
          (SELECT count(*)::int FROM orders WHERE status = 'paid') AS to_ship,
          (SELECT count(*)::int FROM products WHERE active) AS products`);
      s.revenue = Number(s.revenue);
      return s;
    },
  };
}
