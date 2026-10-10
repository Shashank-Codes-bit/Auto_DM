import { activityRepo } from './activity.js';
import { categoriesRepo } from './categories.js';
import { mediaRepo } from './media.js';
import { ordersRepo } from './orders.js';
import { productsRepo } from './products.js';
import { reelsRepo } from './reels.js';
import { settingsRepo } from './settings.js';
import { statsRepo } from './stats.js';
import { usersRepo } from './users.js';

export function createRepos(db) {
  return {
    activity: activityRepo(db),
    categories: categoriesRepo(db),
    media: mediaRepo(db),
    orders: ordersRepo(db),
    products: productsRepo(db),
    reels: reelsRepo(db),
    settings: settingsRepo(db),
    stats: statsRepo(db),
    users: usersRepo(db),
  };
}
