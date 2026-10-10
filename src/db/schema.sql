-- Applied on every startup; every statement must be idempotent.
-- Money is stored as integer paise (₹1 = 100) to avoid rounding errors.

CREATE TABLE IF NOT EXISTS settings (
  key   text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mime       text NOT NULL,
  data       bytea NOT NULL,
  size       integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  description   text NOT NULL DEFAULT '',
  price_paise   integer NOT NULL CHECK (price_paise >= 0),
  mrp_paise     integer CHECK (mrp_paise IS NULL OR mrp_paise >= 0),
  images        jsonb NOT NULL DEFAULT '[]',
  option_label  text NOT NULL DEFAULT '',
  option_values text[] NOT NULL DEFAULT '{}',
  stock         integer CHECK (stock IS NULL OR stock >= 0),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reels (
  ig_media_id   text PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  headline      text NOT NULL DEFAULT '',
  keywords      text[] NOT NULL DEFAULT '{}',
  dm_message    text NOT NULL DEFAULT '',
  button_text   text NOT NULL DEFAULT 'Shop now',
  public_reply  text NOT NULL DEFAULT '',
  active        boolean NOT NULL DEFAULT true,
  permalink     text NOT NULL DEFAULT '',
  thumbnail_url text NOT NULL DEFAULT '',
  caption       text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reel_products (
  reel_id    text NOT NULL REFERENCES reels(ig_media_id) ON DELETE CASCADE,
  product_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position   integer NOT NULL,
  PRIMARY KEY (reel_id, product_id)
);

CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1001;

CREATE TABLE IF NOT EXISTS orders (
  id             serial PRIMARY KEY,
  order_number   text NOT NULL UNIQUE,
  public_token   text NOT NULL UNIQUE,
  reel_id        text REFERENCES reels(ig_media_id) ON DELETE SET NULL,
  source         text NOT NULL DEFAULT '',
  customer_name  text NOT NULL,
  phone          text NOT NULL,
  email          text NOT NULL DEFAULT '',
  address        text NOT NULL,
  city           text NOT NULL,
  state          text NOT NULL,
  pincode        text NOT NULL,
  subtotal_paise integer NOT NULL,
  shipping_paise integer NOT NULL,
  total_paise    integer NOT NULL,
  status         text NOT NULL DEFAULT 'awaiting_payment',
  notes          text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id           serial PRIMARY KEY,
  order_id     integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id   integer REFERENCES products(id) ON DELETE SET NULL,
  name         text NOT NULL,
  image        text NOT NULL DEFAULT '',
  price_paise  integer NOT NULL,
  option_value text NOT NULL DEFAULT '',
  qty          integer NOT NULL CHECK (qty > 0)
);

-- One row per Instagram comment the webhook processed.
CREATE TABLE IF NOT EXISTS activity (
  id         serial PRIMARY KEY,
  comment_id text UNIQUE,
  reel_id    text,
  user_id    text NOT NULL DEFAULT '',
  username   text NOT NULL DEFAULT '',
  text       text NOT NULL DEFAULT '',
  result     text NOT NULL,
  error      text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visits (
  id         serial PRIMARY KEY,
  reel_id    text NOT NULL,
  source     text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE reels ADD COLUMN IF NOT EXISTS media_checked_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS visits_reel_idx ON visits (reel_id);
CREATE INDEX IF NOT EXISTS activity_reel_idx ON activity (reel_id);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders (status);

-- ---- v2: categories, featured products, reel videos, customer accounts ----
CREATE TABLE IF NOT EXISTS categories (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  image_url   text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  position    integer NOT NULL DEFAULT 0,
  visible     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS product_categories (
  product_id  integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id integer NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, category_id)
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
ALTER TABLE reels ADD COLUMN IF NOT EXISTS video_url text NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS users (
  id            serial PRIMARY KEY,
  name          text NOT NULL,
  phone         text NOT NULL UNIQUE,
  email         text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'customer',
  address       jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id integer REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders (user_id);
CREATE INDEX IF NOT EXISTS product_categories_cat_idx ON product_categories (category_id);
