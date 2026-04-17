from __future__ import annotations

import errno
import json
import os
import sqlite3
import webbrowser
from datetime import datetime, timezone
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


BASE_DIR = Path(__file__).resolve().parent
DB_DIR = BASE_DIR / "data"
DB_PATH = DB_DIR / "site_2.sqlite3"


DEFAULT_USERS = [
    {
        "id": "user-gestao",
        "name": "Conta Interna",
        "email": "gestao@vzstore.com.br",
        "username": "gestao",
        "password": "VzStore!2026",
        "role": "admin",
        "mustChangePassword": True,
        "image": "",
    },
]

DEFAULT_PRODUCTS = []

DEFAULT_SUPPLIERS = []

DEFAULT_EMPLOYEES = []

DEFAULT_SETTINGS = {}

LEGACY_USER_ID = "user-cliente"
LEGACY_USER_USERNAME = "cliente"
LEGACY_USER_EMAIL = "cliente@vzstore.com.br"
LEGACY_INTERNAL_USER_ID = "".join(("user", "-", "ad", "min"))
LEGACY_INTERNAL_USER_USERNAME = "".join(("ad", "min"))
LEGACY_INTERNAL_USER_EMAIL = "".join(("ad", "min", "@vzstore.com.br"))

LEGACY_PRODUCT_IDS = {
    "prod-vestido-longo",
    "prod-conjunto-floral",
    "prod-alfaiataria",
    "prod-noite-premium",
    "prod-casual-minimal",
    "prod-ponto-chic",
}

LEGACY_SUPPLIER_IDS = {"sup-1", "sup-2"}
LEGACY_EMPLOYEE_IDS = {"emp-1", "emp-2"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def json_value(value: str | None, fallback: Any) -> Any:
    if not value:
      return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return fallback


def clamp_int(value: Any, fallback: int = 50) -> int:
    try:
        return max(0, min(100, int(float(value))))
    except (TypeError, ValueError):
        return fallback


def parse_product_image_payload(value: str | None) -> dict[str, Any]:
    parsed = json_value(value, None)
    if isinstance(parsed, dict):
        images = parsed.get("images") or []
        if isinstance(images, str):
            images = [images]
        gallery = [str(image).strip() for image in images if str(image).strip()]
        primary = str(parsed.get("primary") or parsed.get("image") or (gallery[0] if gallery else "") or "").strip()
        if primary and primary not in gallery:
            gallery.insert(0, primary)
        return {
            "image": primary,
            "images": gallery,
            "imageFit": str(parsed.get("fit") or "contain"),
            "imagePositionX": clamp_int(parsed.get("positionX"), 50),
            "imagePositionY": clamp_int(parsed.get("positionY"), 50),
        }

    if isinstance(parsed, list):
        gallery = [str(image).strip() for image in parsed if str(image).strip()]
        primary = gallery[0] if gallery else ""
        return {
            "image": primary,
            "images": gallery,
            "imageFit": "contain",
            "imagePositionX": 50,
            "imagePositionY": 50,
        }

    text = str(value or "").strip()
    return {
        "image": text,
        "images": [text] if text else [],
        "imageFit": "contain",
        "imagePositionX": 50,
        "imagePositionY": 50,
    }


def build_product_image_payload(product: dict[str, Any]) -> dict[str, Any]:
    raw_images = product.get("images") or []
    if isinstance(raw_images, str):
        raw_images = [raw_images]
    gallery = [str(image).strip() for image in raw_images if str(image).strip()]
    primary = str(product.get("image") or "").strip()
    if not primary and gallery:
        primary = gallery[0]
    if primary and primary not in gallery:
        gallery.insert(0, primary)
    return {
        "primary": primary,
        "images": gallery,
        "fit": "contain",
        "positionX": clamp_int(product.get("imagePositionX"), 50),
        "positionY": clamp_int(product.get("imagePositionY"), 50),
    }


def pick_image_value(record: dict[str, Any]) -> str:
    return str(
        record.get("image")
        or record.get("avatar")
        or record.get("photo")
        or ""
    ).strip()


def ensure_column(conn: sqlite3.Connection, table: str, column_sql: str) -> None:
    column_name = column_sql.split()[0]
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    if any(row["name"] == column_name for row in rows):
        return

    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column_sql}")


def ensure_default_internal_user(conn: sqlite3.Connection) -> None:
    default_internal_user = DEFAULT_USERS[0]
    row = conn.execute(
        """
        SELECT id
        FROM users
        WHERE id = ?
           OR LOWER(username) IN (?, ?)
           OR LOWER(email) IN (?, ?)
        LIMIT 1
        """,
        (
            default_internal_user["id"],
            default_internal_user["username"],
            LEGACY_INTERNAL_USER_USERNAME,
            default_internal_user["email"],
            LEGACY_INTERNAL_USER_EMAIL,
        ),
    ).fetchone()
    if row:
        conn.execute(
            """
            UPDATE users
            SET id = ?, name = ?, email = ?, username = ?, password = ?, role = ?, must_change_password = ?, image = ?
            WHERE id = ?
            """,
            (
                default_internal_user["id"],
                default_internal_user["name"],
                default_internal_user["email"],
                default_internal_user["username"],
                default_internal_user["password"],
                default_internal_user["role"],
                1 if default_internal_user.get("mustChangePassword") else 0,
                pick_image_value(default_internal_user),
                row["id"],
            ),
        )
        return

    conn.execute(
        """
        INSERT INTO users (id, name, email, username, password, role, must_change_password, created_at, image)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            default_internal_user["id"],
            default_internal_user["name"],
            default_internal_user["email"],
            default_internal_user["username"],
            default_internal_user["password"],
            default_internal_user["role"],
            1 if default_internal_user.get("mustChangePassword") else 0,
            now_iso(),
            pick_image_value(default_internal_user),
        ),
    )


def delete_ids(conn: sqlite3.Connection, table: str, ids: set[str]) -> None:
    clean_ids = [str(item).strip() for item in ids if str(item).strip()]
    if not clean_ids:
        return

    placeholders = ", ".join("?" for _ in clean_ids)
    conn.execute(f"DELETE FROM {table} WHERE id IN ({placeholders})", clean_ids)


def purge_seeded_demo_data(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        DELETE FROM users
        WHERE id = ?
          OR (LOWER(username) = ? AND LOWER(email) = ?)
        """,
        (LEGACY_USER_ID, LEGACY_USER_USERNAME, LEGACY_USER_EMAIL),
    )
    delete_ids(conn, "products", LEGACY_PRODUCT_IDS)
    delete_ids(conn, "suppliers", LEGACY_SUPPLIER_IDS)
    delete_ids(conn, "employees", LEGACY_EMPLOYEE_IDS)

    active_product_ids = {
        row["id"]
        for row in conn.execute("SELECT id FROM products").fetchall()
        if row["id"]
    }
    carts = conn.execute("SELECT user_id, items_json FROM carts").fetchall()
    for row in carts:
        items = json_value(row["items_json"], [])
        if not isinstance(items, list):
            items = []

        filtered_items = []
        for item in items:
            if not isinstance(item, dict):
                continue

            product_id = str(item.get("productId") or "").strip()
            if product_id and product_id in active_product_ids:
                filtered_items.append(item)

        if filtered_items:
            if filtered_items != items:
                conn.execute(
                    "UPDATE carts SET items_json = ?, updated_at = ? WHERE user_id = ?",
                    (json_text(filtered_items), now_iso(), row["user_id"]),
                )
        else:
            conn.execute("DELETE FROM carts WHERE user_id = ?", (row["user_id"],))


def ensure_db() -> None:
    DB_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              email TEXT NOT NULL,
              username TEXT NOT NULL,
              password TEXT NOT NULL,
              role TEXT NOT NULL,
              must_change_password INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              image TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS products (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              description TEXT NOT NULL,
              price REAL NOT NULL,
              quantity INTEGER NOT NULL,
              sizes_json TEXT NOT NULL,
              categories_json TEXT NOT NULL,
              image TEXT NOT NULL,
              featured INTEGER NOT NULL DEFAULT 0,
              active INTEGER NOT NULL DEFAULT 1
            );

            CREATE TABLE IF NOT EXISTS suppliers (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              contact TEXT NOT NULL,
              category TEXT NOT NULL,
              note TEXT NOT NULL,
              image TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS employees (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              role TEXT NOT NULL,
              contact TEXT NOT NULL,
              shift TEXT NOT NULL,
              image TEXT NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS orders (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              user_name TEXT NOT NULL,
              items_json TEXT NOT NULL,
              total REAL NOT NULL,
              status TEXT NOT NULL,
              payment_label TEXT NOT NULL DEFAULT '',
              payment_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS checkout_profiles (
              id TEXT PRIMARY KEY,
              user_id TEXT NOT NULL,
              order_id TEXT NOT NULL DEFAULT '',
              status TEXT NOT NULL DEFAULT 'draft',
              profile_json TEXT NOT NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS carts (
              user_id TEXT PRIMARY KEY,
              items_json TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
              key TEXT PRIMARY KEY,
              value_json TEXT NOT NULL
            );
            """
        )

        ensure_column(conn, "users", "image TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "suppliers", "image TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "employees", "image TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "orders", "payment_label TEXT NOT NULL DEFAULT ''")
        ensure_column(conn, "orders", "payment_json TEXT NOT NULL DEFAULT '{}'")

        purge_seeded_demo_data(conn)
        ensure_default_internal_user(conn)

        seed_table(conn, "users", DEFAULT_USERS, replace_users)
        seed_table(conn, "products", DEFAULT_PRODUCTS, replace_products)
        seed_table(conn, "suppliers", DEFAULT_SUPPLIERS, replace_suppliers)
        seed_table(conn, "employees", DEFAULT_EMPLOYEES, replace_employees)
        seed_table(conn, "orders", [], replace_orders)
        seed_table(conn, "checkout_profiles", [], replace_checkout_profiles)
        seed_table(conn, "carts", {}, replace_carts)


def seed_table(conn: sqlite3.Connection, table: str, default_value: Any, replace_fn) -> None:
    cur = conn.execute(f"SELECT COUNT(*) AS count FROM {table}")
    if cur.fetchone()["count"] == 0:
        replace_fn(conn, default_value)


def replace_users(conn: sqlite3.Connection, users: list[dict[str, Any]]) -> None:
    conn.execute("DELETE FROM users")
    for user in users:
        conn.execute(
            """
            INSERT INTO users (id, name, email, username, password, role, must_change_password, created_at, image)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(user.get("id") or ""),
                str(user.get("name") or ""),
                str(user.get("email") or ""),
                str(user.get("username") or ""),
                str(user.get("password") or ""),
                str(user.get("role") or "cliente"),
                1 if user.get("mustChangePassword") else 0,
                str(user.get("createdAt") or now_iso()),
                pick_image_value(user),
            ),
        )


def replace_products(conn: sqlite3.Connection, products: list[dict[str, Any]]) -> None:
    conn.execute("DELETE FROM products")
    for product in products:
        image_payload = build_product_image_payload(product)
        conn.execute(
            """
            INSERT INTO products (id, name, description, price, quantity, sizes_json, categories_json, image, featured, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(product.get("id") or ""),
                str(product.get("name") or ""),
                str(product.get("description") or ""),
                float(product.get("price") or 0),
                int(product.get("quantity") or 0),
                json_text(product.get("sizes") or []),
                json_text(product.get("categories") or []),
                json_text(image_payload),
                1 if product.get("featured") else 0,
                1 if product.get("active", True) else 0,
            ),
        )


def replace_suppliers(conn: sqlite3.Connection, suppliers: list[dict[str, Any]]) -> None:
    conn.execute("DELETE FROM suppliers")
    for supplier in suppliers:
        conn.execute(
            """
            INSERT INTO suppliers (id, name, contact, category, note, image)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                str(supplier.get("id") or ""),
                str(supplier.get("name") or ""),
                str(supplier.get("contact") or ""),
                str(supplier.get("category") or ""),
                str(supplier.get("note") or ""),
                pick_image_value(supplier),
            ),
        )


def replace_employees(conn: sqlite3.Connection, employees: list[dict[str, Any]]) -> None:
    conn.execute("DELETE FROM employees")
    for employee in employees:
        conn.execute(
            """
            INSERT INTO employees (id, name, role, contact, shift, image)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                str(employee.get("id") or ""),
                str(employee.get("name") or ""),
                str(employee.get("role") or ""),
                str(employee.get("contact") or ""),
                str(employee.get("shift") or ""),
                pick_image_value(employee),
            ),
        )


def replace_orders(conn: sqlite3.Connection, orders: list[dict[str, Any]]) -> None:
    conn.execute("DELETE FROM orders")
    for order in orders:
        payment_snapshot = order.get("payment") or {}
        payment_label = (
            str(order.get("paymentLabel") or "")
            or str(payment_snapshot.get("paymentLabel") or "")
            or str(payment_snapshot.get("label") or "")
        )
        conn.execute(
            """
            INSERT INTO orders (id, user_id, user_name, items_json, total, status, payment_label, payment_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(order.get("id") or ""),
                str(order.get("userId") or ""),
                str(order.get("userName") or ""),
                json_text(order.get("items") or []),
                float(order.get("total") or 0),
                str(order.get("status") or "Recebido"),
                payment_label,
                json_text(payment_snapshot),
                str(order.get("createdAt") or now_iso()),
            ),
        )


def replace_checkout_profiles(conn: sqlite3.Connection, profiles: list[dict[str, Any]]) -> None:
    conn.execute("DELETE FROM checkout_profiles")
    for profile in profiles:
        conn.execute(
            """
            INSERT INTO checkout_profiles (id, user_id, order_id, status, profile_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(profile.get("id") or ""),
                str(profile.get("userId") or ""),
                str(profile.get("orderId") or ""),
                str(profile.get("status") or "draft"),
                json_text(profile),
                str(profile.get("createdAt") or now_iso()),
                str(profile.get("updatedAt") or now_iso()),
            ),
        )


def replace_carts(conn: sqlite3.Connection, carts: dict[str, Any]) -> None:
    conn.execute("DELETE FROM carts")
    for user_id, items in carts.items():
        conn.execute(
            """
            INSERT INTO carts (user_id, items_json, updated_at)
            VALUES (?, ?, ?)
            """,
            (str(user_id), json_text(items or []), now_iso()),
        )


def replace_settings(conn: sqlite3.Connection, settings: dict[str, Any]) -> None:
    conn.execute("DELETE FROM settings")
    conn.execute(
        "INSERT INTO settings (key, value_json) VALUES (?, ?)",
        ("site2_settings", json_text(settings or DEFAULT_SETTINGS)),
    )


def rows_to_users(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "email": row["email"],
            "username": row["username"],
            "password": row["password"],
            "role": row["role"],
            "mustChangePassword": bool(row["must_change_password"]),
            "createdAt": row["created_at"],
            "image": row["image"] if "image" in row.keys() else "",
        }
        for row in rows
    ]


def rows_to_products(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "description": row["description"],
            "price": row["price"],
            "quantity": row["quantity"],
            "sizes": json_value(row["sizes_json"], []),
            "categories": json_value(row["categories_json"], []),
            **parse_product_image_payload(row["image"]),
            "featured": bool(row["featured"]),
            "active": bool(row["active"]),
        }
        for row in rows
    ]


def rows_to_suppliers(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "contact": row["contact"],
            "category": row["category"],
            "note": row["note"],
            "image": row["image"] if "image" in row.keys() else "",
        }
        for row in rows
    ]


def rows_to_employees(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [
        {
            "id": row["id"],
            "name": row["name"],
            "role": row["role"],
            "contact": row["contact"],
            "shift": row["shift"],
            "image": row["image"] if "image" in row.keys() else "",
        }
        for row in rows
    ]


def rows_to_orders(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [
        {
            "id": row["id"],
            "userId": row["user_id"],
            "userName": row["user_name"],
            "items": json_value(row["items_json"], []),
            "total": row["total"],
            "status": row["status"],
            "payment": json_value(row["payment_json"] if "payment_json" in row.keys() else None, {}),
            "paymentLabel": str(
                row["payment_label"]
                if "payment_label" in row.keys() and row["payment_label"]
                else (
                    json_value(row["payment_json"] if "payment_json" in row.keys() else None, {}).get("paymentLabel")
                    or json_value(row["payment_json"] if "payment_json" in row.keys() else None, {}).get("label")
                )
                or ""
            ),
            "createdAt": row["created_at"],
        }
        for row in rows
    ]


def rows_to_checkout_profiles(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [
        {
            **json_value(row["profile_json"], {}),
            "id": row["id"],
            "userId": row["user_id"],
            "orderId": row["order_id"],
            "status": row["status"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
        for row in rows
    ]


def rows_to_carts(rows: list[sqlite3.Row]) -> dict[str, Any]:
    return {row["user_id"]: json_value(row["items_json"], []) for row in rows}


def get_settings(conn: sqlite3.Connection) -> dict[str, Any]:
    row = conn.execute("SELECT value_json FROM settings WHERE key = ?", ("site2_settings",)).fetchone()
    return json_value(row["value_json"] if row else None, DEFAULT_SETTINGS)


def bootstrap_payload() -> dict[str, Any]:
    with connect() as conn:
        return {
            "users": rows_to_users(conn.execute("SELECT * FROM users ORDER BY created_at DESC, name ASC").fetchall()),
            "products": rows_to_products(conn.execute("SELECT * FROM products ORDER BY featured DESC, name ASC").fetchall()),
            "suppliers": rows_to_suppliers(conn.execute("SELECT * FROM suppliers ORDER BY name ASC").fetchall()),
            "employees": rows_to_employees(conn.execute("SELECT * FROM employees ORDER BY name ASC").fetchall()),
            "orders": rows_to_orders(conn.execute("SELECT * FROM orders ORDER BY created_at DESC").fetchall()),
            "checkoutProfiles": rows_to_checkout_profiles(
                conn.execute("SELECT * FROM checkout_profiles ORDER BY updated_at DESC").fetchall()
            ),
            "carts": rows_to_carts(conn.execute("SELECT * FROM carts").fetchall()),
            "settings": get_settings(conn),
        }


def replace_collection(collection: str, payload: Any) -> None:
    with connect() as conn:
        if collection == "users":
            replace_users(conn, list(payload or []))
        elif collection == "products":
            replace_products(conn, list(payload or []))
        elif collection == "suppliers":
            replace_suppliers(conn, list(payload or []))
        elif collection == "employees":
            replace_employees(conn, list(payload or []))
        elif collection == "orders":
            replace_orders(conn, list(payload or []))
        elif collection == "checkout_profiles":
            replace_checkout_profiles(conn, list(payload or []))
        elif collection == "carts":
            replace_carts(conn, dict(payload or {}))
        elif collection == "settings":
            replace_settings(conn, dict(payload or {}))
        else:
            raise ValueError(f"Unknown collection: {collection}")


def read_json_body(handler: SimpleHTTPRequestHandler) -> Any:
    length = int(handler.headers.get("Content-Length") or 0)
    raw = handler.rfile.read(length) if length else b"{}"
    if not raw:
        return {}
    return json.loads(raw.decode("utf-8"))


class SiteHandler(SimpleHTTPRequestHandler):
    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/bootstrap":
            self.respond_json(bootstrap_payload())
            return

        if path == "/api/health":
            self.respond_json({"ok": True})
            return

        if path == "/":
            self.path = "/index.html"
            super().do_GET()
            return

        if path.endswith(".html"):
            target_path = self.translate_path(path)
            if not os.path.exists(target_path):
                fallback = self.translate_path(f"/paginas/{os.path.basename(path)}")
                if os.path.exists(fallback):
                    self.path = f"/paginas/{os.path.basename(path)}"

        super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path
        if path.startswith("/api/sync/"):
            collection = unquote(path.split("/api/sync/", 1)[1]).strip("/")
            try:
                payload = read_json_body(self)
                replace_collection(collection, payload)
                self.respond_json({"ok": True})
            except (ValueError, json.JSONDecodeError) as exc:
                self.respond_json({"ok": False, "error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def log_message(self, format: str, *args: Any) -> None:
        return

    def respond_json(self, payload: Any, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    os.chdir(BASE_DIR)
    ensure_db()
    start_port = int(os.environ.get("SITE_PORT", "8000"))
    server = None
    port = start_port

    for candidate in range(start_port, start_port + 20):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", candidate), partial(SiteHandler, directory=str(BASE_DIR)))
            port = candidate
            break
        except OSError as exc:
            if exc.errno == errno.EADDRINUSE:
                continue
            raise

    if server is None:
        raise OSError(f"Não foi possível iniciar o servidor a partir da porta {start_port}.")

    url = f"http://127.0.0.1:{port}"
    if port != start_port:
        print(f"Porta {start_port} ocupada, usando {port}.")
    print(f"Servidor rodando em {url}")
    try:
      webbrowser.open(url, new=1, autoraise=True)
    except Exception:
      pass
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrando...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
