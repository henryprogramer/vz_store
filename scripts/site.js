(function () {
  const STORAGE_KEYS = {
    auth: "site2_auth_v3",
    users: "site2_users_v3",
    products: "site2_products_v3",
    suppliers: "site2_suppliers_v3",
    employees: "site2_employees_v3",
    carts: "site2_carts_v3",
    orders: "site2_orders_v3",
    checkout: "site2_checkout_v1",
    checkoutProfiles: "site2_checkout_profiles_v1",
    settings: "site2_settings_v1",
    sidebarUI: "site2_sidebar_ui_v1",
  };

  const API_BASE = "/api";
  const STORE_WHATSAPP_DIGITS = "5538999400164";
  const STORE_WHATSAPP_DISPLAY = "+55 38 99940-0164";

  const DEFAULT_USERS = [
    {
      id: "user-gestao",
      name: "Conta Interna",
      email: "gestao@vzstore.com.br",
      username: "gestao",
      password: "VzStore!2026",
      role: "admin",
      mustChangePassword: true,
      image: "",
    },
  ];

  const DEFAULT_PRODUCTS = [];
  const DEFAULT_SUPPLIERS = [];
  const DEFAULT_EMPLOYEES = [];

  const LEGACY_SEED_IDS = {
    user: new Set(["user-cliente"]),
    products: new Set([
      "prod-vestido-longo",
      "prod-conjunto-floral",
      "prod-alfaiataria",
      "prod-noite-premium",
      "prod-casual-minimal",
      "prod-ponto-chic",
    ]),
    suppliers: new Set(["sup-1", "sup-2"]),
    employees: new Set(["emp-1", "emp-2"]),
  };
  const LEGACY_INTERNAL_USER_ID = ["user", "-", "ad", "min"].join("");
  const LEGACY_INTERNAL_USER_USERNAME = ["ad", "min"].join("");
  const LEGACY_INTERNAL_USER_EMAIL = ["ad", "min", "@vzstore.com.br"].join("");

  const PRODUCT_CATEGORIES = ["Festa", "Casual", "Trabalho", "Noite", "Evento", "Minimal", "Básico", "Chic"];
  const CATALOG_PAGE_SIZE = 5;
  const ORDER_STATUSES = [
    "Pago",
    "Recebido",
    "Separando",
    "Pronto para retirada",
    "Em entrega",
    "Entregue",
    "Cancelado",
  ];
  const STORAGE_KEY_SET = new Set(Object.values(STORAGE_KEYS));

  let productLightboxState = {
    productId: "",
    index: 0,
  };

  let productPreviewRenderToken = 0;
  const productPreviewCache = new WeakMap();
  const catalogCarouselState = {
    catalog: 0,
    client: 0,
  };
  let productSaveNotice = "";
  let productSaveNoticeTone = "success";
  let productSaveNoticeTimer = 0;
  let cartNotice = "";
  let cartNoticeTone = "success";
  let cartNoticeTimer = 0;
  let checkoutProfileSyncTimer = 0;
  let uiDialogState = {
    resolve: null,
    opener: null,
    mode: "confirm",
  };

  function safeRead(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function safeWrite(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Keep the page functional even if storage is unavailable.
    }
  }

  function safeRemove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage failures.
    }
  }

  function setProductSaveNotice(message, tone = "success", duration = 2400) {
    productSaveNotice = String(message || "").trim();
    productSaveNoticeTone = tone === "error" ? "error" : "success";

    if (productSaveNoticeTimer) {
      window.clearTimeout(productSaveNoticeTimer);
      productSaveNoticeTimer = 0;
    }

    if (!productSaveNotice) {
      return;
    }

    productSaveNoticeTimer = window.setTimeout(() => {
      productSaveNotice = "";
      productSaveNoticeTimer = 0;
      if (document.body.dataset.role === "vendedora") {
        refreshVisibleUi();
      }
    }, duration);
  }

  async function loadStoreFromServer() {
    try {
      const response = await fetch(`${API_BASE}/bootstrap`, {
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        return;
      }

      const data = await response.json();

      if (Array.isArray(data.users)) {
        const localUsers = safeRead(STORAGE_KEYS.users, []);
        const mergedUsers = mergeUsersWithLocalImages(localUsers, data.users);
        safeWrite(STORAGE_KEYS.users, mergedUsers);
        if (JSON.stringify(mergedUsers) !== JSON.stringify(data.users)) {
          void syncCollectionToServer("users", mergedUsers);
        }
      }

      if (Array.isArray(data.products)) {
        safeWrite(STORAGE_KEYS.products, data.products);
      }

      if (Array.isArray(data.suppliers)) {
        safeWrite(STORAGE_KEYS.suppliers, data.suppliers);
      }

      if (Array.isArray(data.employees)) {
        safeWrite(STORAGE_KEYS.employees, data.employees);
      }

      if (Array.isArray(data.orders)) {
        safeWrite(STORAGE_KEYS.orders, data.orders);
      }

      if (data.carts && typeof data.carts === "object") {
        safeWrite(STORAGE_KEYS.carts, data.carts);
      }

      if (data.settings && typeof data.settings === "object") {
        safeWrite(STORAGE_KEYS.settings, data.settings);
      }

      if (Array.isArray(data.checkoutProfiles)) {
        safeWrite(STORAGE_KEYS.checkoutProfiles, data.checkoutProfiles);
      }
    } catch {
      // Fall back to the local copy when the API is unavailable.
    }
  }

  async function syncCollectionToServer(collection, payload) {
    try {
      await fetch(`${API_BASE}/sync/${encodeURIComponent(collection)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });
    } catch {
      // Keep the UI working even if the server sync fails.
    }
  }

  function mergeUsersWithLocalImages(localUsers, serverUsers) {
    const localById = new Map(
      (Array.isArray(localUsers) ? localUsers : [])
        .filter((user) => user && typeof user === "object")
        .map((user) => [String(user.id || "").trim(), user]),
    );

    return (Array.isArray(serverUsers) ? serverUsers : [])
      .filter((user) => user && typeof user === "object")
      .map((user) => {
        const userId = String(user.id || "").trim();
        const local = localById.get(userId);
        const serverImage = String(user.image || user.avatar || user.photo || "").trim();
        const localImage = String(local?.image || local?.avatar || local?.photo || "").trim();
        const image = serverImage || localImage;

        return image
          ? { ...user, role: normalizeUserRole(user.role), image }
          : { ...user, role: normalizeUserRole(user.role), image: "" };
      });
  }

  function uid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => {
      switch (char) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return char;
      }
    });
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(Number(value) || 0);
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(date);
  }

  function formatOrderDate(value) {
    return formatDate(value) || "Data não informada";
  }

  function normalizeOrderStatus(value) {
    const status = String(value || "").trim();
    return ORDER_STATUSES.includes(status) ? status : "Recebido";
  }

  function orderStatusTone(value) {
    switch (normalizeOrderStatus(value)) {
      case "Pago":
        return "success";
      case "Separando":
        return "warning";
      case "Pronto para retirada":
      case "Em entrega":
        return "info";
      case "Entregue":
        return "success";
      case "Cancelado":
        return "danger";
      default:
        return "accent";
    }
  }

  function orderStatusClass(value) {
    return `status-pill status-pill--${orderStatusTone(value)}`;
  }

  function orderItemsSummary(items, limit = 3) {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      return "Nenhum item no pedido.";
    }

    const visible = list.slice(0, limit).map((item) => {
      const quantity = Number(item?.quantity) || 0;
      const name = String(item?.name || "Produto").trim();
      return quantity > 0 ? `${quantity}x ${name}` : name;
    });

    const remainder = list.length - visible.length;
    return remainder > 0 ? `${visible.join(" • ")} • +${remainder}` : visible.join(" • ");
  }

  function getOrderStatusCounts(orders) {
    const counts = new Map();
    ORDER_STATUSES.forEach((status) => {
      counts.set(status, 0);
    });

    (Array.isArray(orders) ? orders : []).forEach((order) => {
      const status = normalizeOrderStatus(order?.status);
      counts.set(status, (counts.get(status) || 0) + 1);
    });

    return ORDER_STATUSES.map((status) => ({
      label: status,
      value: counts.get(status) || 0,
      tone: orderStatusTone(status),
    }));
  }

  function getPendingOrderCount(orders, userId = "") {
    return (Array.isArray(orders) ? orders : []).filter((order) => {
      if (userId && order?.userId !== userId) {
        return false;
      }

      const status = normalizeOrderStatus(order?.status);
      return status !== "Entregue" && status !== "Cancelado";
    }).length;
  }

  function setCartNotice(message, tone = "success", duration = 2600) {
    cartNotice = String(message || "").trim();
    cartNoticeTone = tone === "error" ? "error" : "success";

    if (cartNoticeTimer) {
      window.clearTimeout(cartNoticeTimer);
      cartNoticeTimer = 0;
    }

    if (!cartNotice) {
      return;
    }

    cartNoticeTimer = window.setTimeout(() => {
      cartNotice = "";
      cartNoticeTimer = 0;
      syncCartNoticeViews();
    }, duration);

    syncCartNoticeViews();
  }

  function cartNoticeClass() {
    return cartNoticeTone === "error" ? "is-error" : "is-success";
  }

  function renderCartNoticeToast() {
    if (!cartNotice) {
      return "";
    }

    const title = cartNoticeTone === "error" ? "Carrinho com atenção" : "Carrinho atualizado";

    return `
      <div class="cart-toast ${cartNoticeClass()}" data-cart-toast role="status" aria-live="polite">
        <strong class="cart-toast__title">${escapeHtml(title)}</strong>
        <span class="cart-toast__message">${escapeHtml(cartNotice)}</span>
      </div>
    `;
  }

  function syncCartNoticeViews() {
    document.querySelectorAll("[data-cart-notice]").forEach((notice) => {
      if (!cartNotice) {
        notice.hidden = true;
        notice.className = "cart-preview__notice";
        notice.textContent = "";
        return;
      }

      notice.hidden = false;
      notice.className = `cart-preview__notice ${cartNoticeClass()}`;
      notice.textContent = cartNotice;
    });

    document.querySelectorAll("[data-cart-toast]").forEach((toast) => toast.remove());
  }

  function isUiDialogOpen() {
    return document.body.classList.contains("is-ui-dialog-open");
  }

  function ensureUiDialog() {
    let dialog = document.querySelector("[data-ui-dialog]");
    if (dialog) {
      return dialog;
    }

    dialog = document.createElement("div");
    dialog.className = "ui-dialog";
    dialog.hidden = true;
    dialog.setAttribute("data-ui-dialog", "");
    dialog.innerHTML = `
      <div class="ui-dialog__backdrop" data-ui-dialog-cancel></div>
      <div class="ui-dialog__panel" role="dialog" aria-modal="true" aria-labelledby="ui-dialog-title">
        <button type="button" class="ui-dialog__close" data-ui-dialog-cancel aria-label="Fechar diálogo">×</button>
        <div class="ui-dialog__header">
          <p class="section__eyebrow" data-ui-dialog-eyebrow><span class="section__dot" aria-hidden="true"></span>Confirmação</p>
          <h3 id="ui-dialog-title" data-ui-dialog-title></h3>
          <p class="ui-dialog__message" data-ui-dialog-message></p>
        </div>
        <form class="ui-dialog__form" data-ui-dialog-form>
          <div class="ui-dialog__field-wrap" data-ui-dialog-field-wrap hidden></div>
          <div class="ui-dialog__footer">
            <button type="button" class="btn btn--light" data-ui-dialog-cancel>Cancelar</button>
            <button type="submit" class="btn btn--solid" data-ui-dialog-confirm>OK</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(dialog);
    return dialog;
  }

  function closeUiDialog(result = null) {
    const dialog = document.querySelector("[data-ui-dialog]");
    const state = uiDialogState;
    if (state.resolve) {
      state.resolve(result);
    }

    uiDialogState = {
      resolve: null,
      opener: null,
      mode: "confirm",
    };

    if (dialog) {
      dialog.hidden = true;
      dialog.classList.remove("is-open");
      dialog.removeAttribute("data-tone");
      dialog.removeAttribute("data-mode");
    }

    document.body.classList.remove("is-ui-dialog-open");

    if (state.opener && typeof state.opener.focus === "function") {
      window.setTimeout(() => {
        state.opener.focus({ preventScroll: true });
      }, 0);
    }
  }

  function showUiDialog(options = {}) {
    const dialog = ensureUiDialog();
    const mode = options.mode === "alert" ? "alert" : options.mode === "prompt" ? "prompt" : "confirm";
    const tone = options.tone === "danger" ? "danger" : options.tone === "success" ? "success" : "accent";
    const title = String(options.title || "").trim();
    const message = String(options.message || "").trim();
    const confirmLabel = String(options.confirmLabel || (mode === "alert" ? "Entendi" : "OK")).trim();
    const cancelLabel = String(options.cancelLabel || "Cancelar").trim();
    const eyebrow = String(options.eyebrow || (mode === "prompt" ? "Editar" : mode === "alert" ? "Aviso" : "Confirmação")).trim();
    const fieldWrap = dialog.querySelector("[data-ui-dialog-field-wrap]");
    const eyebrowEl = dialog.querySelector("[data-ui-dialog-eyebrow]");
    const titleEl = dialog.querySelector("[data-ui-dialog-title]");
    const messageEl = dialog.querySelector("[data-ui-dialog-message]");
    const formEl = dialog.querySelector("[data-ui-dialog-form]");
    const confirmButton = dialog.querySelector("[data-ui-dialog-confirm]");
    const cancelButton = dialog.querySelector("[data-ui-dialog-cancel]");
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    if (uiDialogState.resolve) {
      closeUiDialog(null);
    }

    uiDialogState = {
      resolve: null,
      opener: activeElement,
      mode,
    };

    dialog.dataset.mode = mode;
    dialog.dataset.tone = tone;
    dialog.hidden = false;
    dialog.classList.add("is-open");
    document.body.classList.add("is-ui-dialog-open");

    if (eyebrowEl) {
      eyebrowEl.innerHTML = `<span class="section__dot" aria-hidden="true"></span>${escapeHtml(eyebrow)}`;
    }

    if (titleEl) {
      titleEl.textContent = title;
    }

    if (messageEl) {
      messageEl.textContent = message;
    }

    if (confirmButton) {
      confirmButton.textContent = confirmLabel;
    }

    if (cancelButton) {
      cancelButton.textContent = cancelLabel;
      cancelButton.hidden = mode === "alert";
    }

    if (fieldWrap) {
      if (mode === "prompt") {
        const inputType = String(options.inputType || "number").trim() || "number";
        const inputName = String(options.inputName || "value").trim() || "value";
        const inputLabel = String(options.inputLabel || "Valor").trim();
        const inputHint = String(options.inputHint || "").trim();
        const defaultValue = String(options.defaultValue ?? "").trim();
        const placeholder = String(options.placeholder || "").trim();
        const min = options.min ?? "";
        const max = options.max ?? "";
        const step = options.step ?? "1";

        fieldWrap.hidden = false;
        fieldWrap.innerHTML = `
          <label class="field ui-dialog__field">
            <span data-ui-dialog-input-label>${escapeHtml(inputLabel)}</span>
            <input
              type="${escapeAttr(inputType)}"
              name="${escapeAttr(inputName)}"
              value="${escapeAttr(defaultValue)}"
              placeholder="${escapeAttr(placeholder)}"
              ${min !== "" ? `min="${escapeAttr(min)}"` : ""}
              ${max !== "" ? `max="${escapeAttr(max)}"` : ""}
              ${step !== "" ? `step="${escapeAttr(step)}"` : ""}
              data-ui-dialog-input
            />
            ${inputHint ? `<p class="ui-dialog__field-hint" data-ui-dialog-input-hint>${escapeHtml(inputHint)}</p>` : ""}
          </label>
        `;
      } else {
        fieldWrap.hidden = true;
        fieldWrap.innerHTML = "";
      }
    }

    return new Promise((resolve) => {
      uiDialogState.resolve = resolve;
      window.requestAnimationFrame(() => {
        const input = dialog.querySelector("[data-ui-dialog-input]");
        if (mode === "prompt" && input) {
          input.focus({ preventScroll: true });
          if (typeof input.select === "function") {
            input.select();
          }
          return;
        }

        confirmButton?.focus({ preventScroll: true });
      });
    });
  }

  function showUiAlert(message, options = {}) {
    return showUiDialog({
      mode: "alert",
      title: options.title || "Atenção",
      message,
      tone: options.tone || "accent",
      confirmLabel: options.confirmLabel || "Entendi",
      eyebrow: options.eyebrow || "Aviso",
    });
  }

  function showUiConfirm(message, options = {}) {
    return showUiDialog({
      mode: "confirm",
      title: options.title || "Confirmar ação",
      message,
      tone: options.tone || "accent",
      confirmLabel: options.confirmLabel || "Confirmar",
      cancelLabel: options.cancelLabel || "Cancelar",
      eyebrow: options.eyebrow || "Confirmação",
    });
  }

  function showUiPrompt(message, options = {}) {
    return showUiDialog({
      mode: "prompt",
      title: options.title || "Editar valor",
      message,
      tone: options.tone || "accent",
      confirmLabel: options.confirmLabel || "Salvar",
      cancelLabel: options.cancelLabel || "Cancelar",
      eyebrow: options.eyebrow || "Editar",
      inputType: options.inputType || "number",
      inputLabel: options.inputLabel || "Valor",
      inputHint: options.inputHint || "",
      inputName: options.inputName || "value",
      defaultValue: options.defaultValue ?? "",
      placeholder: options.placeholder || "",
      min: options.min ?? "",
      max: options.max ?? "",
      step: options.step ?? "1",
    });
  }

  function splitList(value) {
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean);
    }

    return String(value || "")
      .split(/[,;\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function normalizeUsername(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
  }

  function normalizePhoneNumber(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function normalizeWhatsAppNumber(value) {
    let digits = normalizePhoneNumber(value).replace(/^0+/, "");

    if (!digits) {
      return "";
    }

    if ((digits.length === 10 || digits.length === 11) && !digits.startsWith("55")) {
      digits = `55${digits}`;
    }

    return digits;
  }

  function getStoreWhatsAppNumber(settings = getSettings()) {
    const configured = String(settings?.whatsapp || settings?.phone || "").trim();
    return normalizeWhatsAppNumber(configured) || STORE_WHATSAPP_DIGITS;
  }

  function formatWhatsAppDisplay(value) {
    const digits = normalizeWhatsAppNumber(value) || STORE_WHATSAPP_DIGITS;

    if (digits === STORE_WHATSAPP_DIGITS) {
      return STORE_WHATSAPP_DISPLAY;
    }

    if (digits.length === 13 && digits.startsWith("55")) {
      return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 9)}-${digits.slice(9)}`;
    }

    if (digits.length === 12 && digits.startsWith("55")) {
      return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 8)}-${digits.slice(8)}`;
    }

    return `+${digits}`;
  }

  function parseNumber(value) {
    const normalized = String(value ?? "")
      .replace(/\./g, "")
      .replace(",", ".")
      .trim();
    const number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  }

  function pageNameFromPath(pathname) {
    const source = String(pathname || "");
    if (!source) {
      return "";
    }

    const parts = source.split("/");
    const name = parts[parts.length - 1] || "";
    return name.split("?")[0].split("#")[0];
  }

  function currentPageName() {
    return pageNameFromPath(window.location.pathname);
  }

  function pageUrl(page) {
    return new URL(page, window.location.href).toString();
  }

  function goTo(page) {
    window.location.assign(page);
  }

  function isAdmin(user) {
    return Boolean(user && user.role === "admin");
  }

  function normalizeUserRole(value) {
    return value === "admin" ? "admin" : "cliente";
  }

  function isClient(user) {
    return Boolean(user && user.role !== "admin");
  }

  function defaultPageForUser(user) {
    return isAdmin(user) ? "vendedora.html" : "cliente.html";
  }

  function targetAllowedForUser(user, nextPage) {
    const page = pageNameFromPath(nextPage || "");
    if (!page) {
      return null;
    }

    if (page === "checkout.html") {
      return user ? page : null;
    }

    if (page === "vendedora.html") {
      return isAdmin(user) ? page : null;
    }

    if (page === "cliente.html") {
      return isAdmin(user) ? null : page;
    }

    if (page === "index.html" || page === "catalogo.html" || page === "acesso.html") {
      return page;
    }

    return null;
  }

  function ensureSeededStorage() {
    const defaultInternalUser = {
      ...DEFAULT_USERS[0],
      image: "",
    };

    const storedUsers = safeRead(STORAGE_KEYS.users, []);
    if (!Array.isArray(storedUsers) || storedUsers.length === 0) {
      safeWrite(STORAGE_KEYS.users, DEFAULT_USERS);
    } else {
      const migratedUsers = storedUsers
        .filter((user) => {
          if (!user || typeof user !== "object") {
            return false;
          }

          const userId = String(user.id || "").trim();
          const username = normalizeUsername(user.username);
          const email = normalizeEmail(user.email);
          if (LEGACY_SEED_IDS.user.has(userId)) {
            return false;
          }

          return !(username === "cliente" && email === "cliente@vzstore.com.br");
        })
        .map((user) => {
          const userId = String(user.id || "").trim();
          const username = normalizeUsername(user.username);
          const email = normalizeEmail(user.email);
          const shouldNormalizeInternalUser =
            userId === LEGACY_INTERNAL_USER_ID ||
            userId === defaultInternalUser.id ||
            username === LEGACY_INTERNAL_USER_USERNAME ||
            username === defaultInternalUser.username ||
            email === LEGACY_INTERNAL_USER_EMAIL ||
            email === defaultInternalUser.email;

          if (shouldNormalizeInternalUser) {
            return {
              ...defaultInternalUser,
              image: String(user.image || user.avatar || user.photo || "").trim(),
            };
          }

          return {
            ...user,
            role: normalizeUserRole(user.role),
            image: String(user.image || user.avatar || user.photo || "").trim(),
          };
        });

      const hasInternalUser = migratedUsers.some((user) => String(user.id || "").trim() === defaultInternalUser.id);
      if (!hasInternalUser) {
        migratedUsers.unshift({
          ...defaultInternalUser,
        });
      }

      if (JSON.stringify(migratedUsers) !== JSON.stringify(storedUsers)) {
        safeWrite(STORAGE_KEYS.users, migratedUsers);
        void syncCollectionToServer("users", migratedUsers);
      }
    }

    const storedAuth = safeRead(STORAGE_KEYS.auth, null);
    if (storedAuth && String(storedAuth.userId || "").trim() === LEGACY_INTERNAL_USER_ID) {
      safeWrite(STORAGE_KEYS.auth, {
        ...storedAuth,
        userId: defaultInternalUser.id,
      });
    }

    const storedProducts = safeRead(STORAGE_KEYS.products, []);
    if (!Array.isArray(storedProducts) || storedProducts.length === 0) {
      safeWrite(STORAGE_KEYS.products, []);
    } else {
      const migratedProducts = storedProducts
        .filter((product) => product && typeof product === "object")
        .filter((product) => !LEGACY_SEED_IDS.products.has(String(product.id || "").trim()))
        .map((product) => ({
          ...product,
          imageFit: String(product.imageFit || "contain").trim() || "contain",
        }));

      if (JSON.stringify(migratedProducts) !== JSON.stringify(storedProducts)) {
        safeWrite(STORAGE_KEYS.products, migratedProducts);
        void syncCollectionToServer("products", migratedProducts);
      }
    }

    if (!Array.isArray(safeRead(STORAGE_KEYS.suppliers, null)) || safeRead(STORAGE_KEYS.suppliers, []).length === 0) {
      safeWrite(STORAGE_KEYS.suppliers, []);
    } else {
      const storedSuppliers = safeRead(STORAGE_KEYS.suppliers, []);
      const migratedSuppliers = storedSuppliers
        .filter((item) => item && typeof item === "object" && !LEGACY_SEED_IDS.suppliers.has(String(item.id || "").trim()))
        .map((item) => ({
          ...item,
          image: String(item.image || item.avatar || item.photo || "").trim(),
        }));

      if (JSON.stringify(migratedSuppliers) !== JSON.stringify(storedSuppliers)) {
        safeWrite(STORAGE_KEYS.suppliers, migratedSuppliers);
        void syncCollectionToServer("suppliers", migratedSuppliers);
      }
    }

    if (!Array.isArray(safeRead(STORAGE_KEYS.employees, null)) || safeRead(STORAGE_KEYS.employees, []).length === 0) {
      safeWrite(STORAGE_KEYS.employees, []);
    } else {
      const storedEmployees = safeRead(STORAGE_KEYS.employees, []);
      const migratedEmployees = storedEmployees
        .filter((item) => item && typeof item === "object" && !LEGACY_SEED_IDS.employees.has(String(item.id || "").trim()))
        .map((item) => ({
          ...item,
          image: String(item.image || item.avatar || item.photo || "").trim(),
        }));

      if (JSON.stringify(migratedEmployees) !== JSON.stringify(storedEmployees)) {
        safeWrite(STORAGE_KEYS.employees, migratedEmployees);
        void syncCollectionToServer("employees", migratedEmployees);
      }
    }

    const currentProductIds = new Set(
      (Array.isArray(safeRead(STORAGE_KEYS.products, [])) ? safeRead(STORAGE_KEYS.products, []) : [])
        .map((item) => String(item?.id || "").trim())
        .filter(Boolean),
    );

    const storedCarts = safeRead(STORAGE_KEYS.carts, null);
    if (!storedCarts || typeof storedCarts !== "object" || Array.isArray(storedCarts)) {
      safeWrite(STORAGE_KEYS.carts, {});
    } else {
      const migratedCarts = Object.entries(storedCarts).reduce((acc, [userId, items]) => {
        const nextItems = Array.isArray(items)
          ? items
              .filter((item) => currentProductIds.has(String(item?.productId || "").trim()))
              .map((item) => ({
                ...item,
                image: String(item.image || "").trim(),
              }))
          : [];

        if (nextItems.length) {
          acc[userId] = nextItems;
        }

        return acc;
      }, {});

      if (JSON.stringify(migratedCarts) !== JSON.stringify(storedCarts)) {
        safeWrite(STORAGE_KEYS.carts, migratedCarts);
        void syncCollectionToServer("carts", migratedCarts);
      }
    }

    if (!Array.isArray(safeRead(STORAGE_KEYS.orders, null))) {
      safeWrite(STORAGE_KEYS.orders, []);
    }

    if (!Array.isArray(safeRead(STORAGE_KEYS.checkoutProfiles, null))) {
      safeWrite(STORAGE_KEYS.checkoutProfiles, []);
    }

    if (!safeRead(STORAGE_KEYS.settings, null) || typeof safeRead(STORAGE_KEYS.settings, {}) !== "object") {
      safeWrite(STORAGE_KEYS.settings, {});
    }
  }

  function getUsers() {
    return safeRead(STORAGE_KEYS.users, []);
  }

  async function saveUsers(users) {
    safeWrite(STORAGE_KEYS.users, users);
    await syncCollectionToServer("users", users);
  }

  function getProducts() {
    return safeRead(STORAGE_KEYS.products, []);
  }

  function saveProducts(products) {
    safeWrite(STORAGE_KEYS.products, products);
    void syncCollectionToServer("products", products);
  }

  function getSuppliers() {
    return safeRead(STORAGE_KEYS.suppliers, []);
  }

  function saveSuppliers(items) {
    safeWrite(STORAGE_KEYS.suppliers, items);
    void syncCollectionToServer("suppliers", items);
  }

  function getEmployees() {
    return safeRead(STORAGE_KEYS.employees, []);
  }

  function saveEmployees(items) {
    safeWrite(STORAGE_KEYS.employees, items);
    void syncCollectionToServer("employees", items);
  }

  function getOrders() {
    return safeRead(STORAGE_KEYS.orders, []);
  }

  function saveOrders(items) {
    safeWrite(STORAGE_KEYS.orders, items);
    void syncCollectionToServer("orders", items);
  }

  function getCarts() {
    return safeRead(STORAGE_KEYS.carts, {});
  }

  function saveCarts(items) {
    safeWrite(STORAGE_KEYS.carts, items);
    void syncCollectionToServer("carts", items);
  }

  function getSettings() {
    return safeRead(STORAGE_KEYS.settings, {});
  }

  function saveSettings(items) {
    safeWrite(STORAGE_KEYS.settings, items);
    void syncCollectionToServer("settings", items);
  }

  function buildWhatsAppLink(value) {
    const digits = normalizeWhatsAppNumber(value) || STORE_WHATSAPP_DIGITS;
    return digits ? `https://wa.me/${digits}` : "";
  }

  function hydrateWhatsAppLinks() {
    const settings = getSettings();
    const href = buildWhatsAppLink(getStoreWhatsAppNumber(settings));

    document.querySelectorAll("[data-whatsapp-link]").forEach((link) => {
      if (href) {
        link.setAttribute("href", href);
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
        return;
      }

      const fallback = link.getAttribute("data-whatsapp-fallback") || link.getAttribute("href") || "#";
      link.setAttribute("href", fallback);
      link.removeAttribute("target");
      link.removeAttribute("rel");
    });
  }

  function getAuthState() {
    return safeRead(STORAGE_KEYS.auth, null);
  }

  function saveAuthState(userId) {
    safeWrite(STORAGE_KEYS.auth, {
      userId,
      loggedAt: Date.now(),
    });
  }

  function clearAuthState() {
    safeRemove(STORAGE_KEYS.auth);
  }

  function getCurrentUser() {
    const auth = getAuthState();
    if (!auth || !auth.userId) {
      return null;
    }

    return getUsers().find((user) => user.id === auth.userId) || null;
  }

  function findUserByCredentials(identifier, password) {
    const normalized = normalizeUsername(identifier);
    return getUsers().find((user) => {
      const usernameMatch = normalizeUsername(user.username) === normalized;
      const emailMatch = normalizeEmail(user.email) === normalized;
      return (usernameMatch || emailMatch) && String(user.password || "") === String(password || "");
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Falha ao ler arquivo"));
      reader.readAsDataURL(file);
    });
  }

  function readFilesAsDataUrls(files) {
    return Promise.all(Array.from(files || []).map((file) => readFileAsDataUrl(file)));
  }

  async function collectSingleImageState(form, existingItem, options = {}) {
    const fileInputName = options.fileInputName || "imageFile";
    const fileInput = form.querySelector(`input[name="${fileInputName}"]`);
    const file = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
    const existingImage = String(
      existingItem?.image || existingItem?.avatar || existingItem?.photo || "",
    ).trim();

    if (file) {
      return await readFileAsDataUrl(file);
    }

    return existingImage;
  }

  async function collectProductFormState(form, existingProduct) {
    const formData = new FormData(form);
    const fileInput = form.querySelector('input[name="imageFiles"]');
    const files = fileInput && fileInput.files ? Array.from(fileInput.files) : [];
    const cache = productPreviewCache.get(form) || null;
    const fileSignature = files
      .map((file) => [file.name, file.size, file.lastModified].join(":"))
      .join("|");
    let fileImages = [];

    if (files.length) {
      if (cache && cache.signature === fileSignature && Array.isArray(cache.images)) {
        fileImages = cache.images;
      } else {
        fileImages = await readFilesAsDataUrls(files);
        productPreviewCache.set(form, {
          signature: fileSignature,
          images: fileImages,
        });
      }
    } else {
      productPreviewCache.delete(form);
    }

    const existingGallery = getProductGallery(existingProduct || {});
    const gallery = [...fileImages].map((image) => String(image || "").trim()).filter(Boolean);
    const requestedPrimary = String(formData.get("primaryImage") || existingProduct?.image || "").trim();
    const finalGallery = reorderGallery(gallery.length ? gallery : existingGallery, requestedPrimary);
    const primaryImage = finalGallery[0] || String(existingProduct?.image || "").trim();
    const imageFit = "contain";
    const imagePositionX = clampPercentage(formData.get("imagePositionX") || existingProduct?.imagePositionX || 50, 50);
    const imagePositionY = clampPercentage(formData.get("imagePositionY") || existingProduct?.imagePositionY || 50, 50);

    return {
      images: finalGallery,
      image: primaryImage,
      imageFit,
      imagePositionX,
      imagePositionY,
    };
  }

  function reorderGallery(gallery, primaryImage) {
    const normalized = [];
    (Array.isArray(gallery) ? gallery : []).forEach((image) => {
      const value = String(image || "").trim();
      if (value && !normalized.includes(value)) {
        normalized.push(value);
      }
    });

    const candidate = String(primaryImage || "").trim();
    if (!candidate) {
      return normalized;
    }

    const candidateIndex = normalized.indexOf(candidate);
    if (candidateIndex > 0) {
      normalized.splice(candidateIndex, 1);
      normalized.unshift(candidate);
    }

    return normalized;
  }

  function getProductFormItem(form) {
    const id = String(form?.querySelector('[name="id"]')?.value || "").trim();
    if (!id) {
      return null;
    }

    return getProducts().find((item) => item.id === id) || null;
  }

  async function buildProductDraft(form) {
    const formData = new FormData(form);
    const existingProduct = getProductFormItem(form);
    const imageState = await collectProductFormState(form, existingProduct);

    return {
      id: existingProduct?.id || uid("product"),
      name: String(formData.get("name") || "").trim(),
      description: String(formData.get("description") || "").trim(),
      price: parseNumber(formData.get("price")),
      quantity: Math.max(0, Math.round(parseNumber(formData.get("quantity")))),
      sizes: splitList(formData.get("sizes")),
      categories: splitList(formData.get("categories")),
      image: imageState.image,
      images: imageState.images,
      imageFit: imageState.imageFit,
      imagePositionX: imageState.imagePositionX,
      imagePositionY: imageState.imagePositionY,
      featured: Boolean(form.querySelector('input[name="featured"]')?.checked),
      active: Boolean(form.querySelector('input[name="active"]')?.checked),
    };
  }

  function featuredFirst(products) {
    return [...products].sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)));
  }

  function productStockLabel(product) {
    if (!product.active || Number(product.quantity) <= 0) {
      return "Esgotado";
    }

    return `${Number(product.quantity) || 0} em estoque`;
  }

  function firstCategory(product) {
    if (Array.isArray(product.categories) && product.categories.length > 0) {
      return product.categories[0];
    }

    if (product.category) {
      return product.category;
    }

    return "Coleção";
  }

  function productMetaLine(product) {
    const sizes = Array.isArray(product.sizes) ? product.sizes : [];
    const categories = Array.isArray(product.categories) ? product.categories : [];
    const sizePart = sizes.length ? `Tamanhos: ${sizes.join(", ")}` : "Tamanho único";
    const categoryPart = categories.length > 1 ? `Categorias: ${categories.join(", ")}` : "";
    const stockPart = productStockLabel(product);
    return [sizePart, categoryPart, stockPart].filter(Boolean).join(" • ");
  }

  function clampPercentage(value, fallback = 50) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return fallback;
    }

    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function getProductGallery(product) {
    const gallery = [];
    const pushImage = (value) => {
      const image = String(value || "").trim();
      if (image && !gallery.includes(image)) {
        gallery.push(image);
      }
    };

    if (Array.isArray(product?.images)) {
      product.images.forEach(pushImage);
    }

    const directImage = String(product?.image || "").trim();
    if (directImage) {
      if ((directImage.startsWith("{") || directImage.startsWith("[")) && !gallery.length) {
        try {
          const parsed = JSON.parse(directImage);
          if (Array.isArray(parsed)) {
            parsed.forEach(pushImage);
          } else if (parsed && typeof parsed === "object") {
            if (Array.isArray(parsed.images)) {
              parsed.images.forEach(pushImage);
            }

            pushImage(parsed.primary || parsed.image || "");
          }
        } catch {
          pushImage(directImage);
        }
      } else {
        pushImage(directImage);
      }
    }

    return gallery;
  }

  function getProductImageFit(product) {
    const fit = String(product?.imageFit || "contain").trim() || "contain";
    return fit === "cover" || fit === "contain" ? fit : "contain";
  }

  function getProductImageBackgroundSize(product) {
    if (!getProductGallery(product).length) {
      return "cover";
    }

    return "contain";
  }

  function getProductImagePosition(product) {
    const x = clampPercentage(product?.imagePositionX, 50);
    const y = clampPercentage(product?.imagePositionY, 50);
    return `${x}% ${y}%`;
  }

  function getProductCardStyle(product, image) {
    if (!image) {
      return "";
    }

    const fit = escapeAttr(getProductImageBackgroundSize(product));
    const position = escapeAttr(getProductImagePosition(product));
    return `style="background-image:url('${escapeAttr(image)}');background-size:${fit};background-position:${position};background-repeat:no-repeat;"`;
  }

  function productCardTemplate(product, scope, currentUser) {
    const gallery = getProductGallery(product);
    const image = gallery[0] || "";
    const artClass = image ? "product-card__art product-card__art--photo" : "product-card__art";
    const artStyle = getProductCardStyle(product, image);
    const categories = Array.isArray(product.categories) ? product.categories : [];
    const tags = categories.length ? categories : [firstCategory(product)];
    const isAvailable = Boolean(product.active) && Number(product.quantity) > 0;
    const actionLabelHome = "Ver catálogo";
    const actionLabelShop = currentUser ? "Adicionar ao carrinho" : "Entrar para comprar";
    const actionHref = currentUser ? "#" : "acesso.html?next=cliente.html";

    const actionHtml =
      scope === "home"
        ? `<a class="product-card__action" href="catalogo.html">${actionLabelHome}</a>`
        : !isAvailable
          ? `<button class="product-card__action" type="button" disabled>Esgotado</button>`
          : currentUser
            ? `<button class="product-card__action" type="button" data-add-to-cart="${escapeAttr(product.id)}">${actionLabelShop}</button>`
            : `<a class="product-card__action" href="${actionHref}">${actionLabelShop}</a>`;

    const artInner = image
      ? `<span class="product-card__photo-overlay"></span>${gallery.length > 1 ? `<span class="product-card__gallery-count">+${gallery.length - 1} fotos</span>` : ""}`
      : `<span class="product-card__halo"></span><span class="product-card__silhouette"></span>`;

    return `
      <article class="product-card${product.featured ? " product-card--featured" : ""}" data-product-id="${escapeAttr(product.id)}">
        <span class="product-card__tag">${escapeHtml(tags[0])}</span>
        <div class="${artClass}" ${artStyle} data-open-product="${escapeAttr(product.id)}" role="button" tabindex="0" aria-label="Abrir fotos de ${escapeAttr(product.name)}">
          ${artInner}
        </div>
        <div class="product-card__foot">
          <div>
            <h3>${escapeHtml(product.name)}</h3>
            <p>${escapeHtml(product.description || "Produto da coleção")}</p>
            <p class="product-card__meta">${escapeHtml(productMetaLine(product))}</p>
          </div>
          <strong>${formatCurrency(product.price)}</strong>
        </div>
        ${actionHtml}
      </article>
    `;
  }

  function renderProductCards(products, scope, currentUser, limit) {
    const source = scope === "home" ? featuredFirst(products).slice(0, limit || 4) : products;
    if (!source.length) {
      return `
        <article class="empty-state">
          <h3>Nenhum produto cadastrado</h3>
          <p>Cadastre uma peça no painel interno para ela aparecer aqui.</p>
        </article>
      `;
    }

    return source.map((product) => productCardTemplate(product, scope, currentUser)).join("");
  }

  function getCatalogCarouselKey(scope) {
    return scope === "client" ? "client" : "catalog";
  }

  function stepCatalogCarousel(scope, delta) {
    const key = getCatalogCarouselKey(scope);
    const totalPages = Math.max(1, Math.ceil(getProducts().length / CATALOG_PAGE_SIZE));
    catalogCarouselState[key] = (catalogCarouselState[key] + delta + totalPages) % totalPages;
    refreshVisibleUi();
  }

  function renderCatalogCarousel(products, scope, currentUser) {
    const source = Array.isArray(products) ? products : [];
    if (!source.length) {
      return `
        <article class="empty-state">
          <h3>Nenhum produto cadastrado</h3>
          <p>Cadastre uma peça no painel interno para ela aparecer aqui.</p>
        </article>
      `;
    }

    const key = getCatalogCarouselKey(scope);
    const pageCount = Math.max(1, Math.ceil(source.length / CATALOG_PAGE_SIZE));
    const currentPage = Math.min(catalogCarouselState[key] || 0, pageCount - 1);
    catalogCarouselState[key] = currentPage;

    const pages = Array.from({ length: pageCount }, (_, pageIndex) => {
      const pageItems = source.slice(pageIndex * CATALOG_PAGE_SIZE, pageIndex * CATALOG_PAGE_SIZE + CATALOG_PAGE_SIZE);
      return `
        <div class="catalog-carousel__page">
          ${renderProductCards(pageItems, scope, currentUser)}
        </div>
      `;
    }).join("");

    const navDisabled = pageCount <= 1 ? "disabled" : "";

    return `
      <div class="catalog-carousel" data-catalog-carousel data-catalog-scope="${escapeAttr(key)}" aria-label="Catálogo em carrossel">
        <div class="catalog-carousel__toolbar">
          <div class="catalog-carousel__controls">
            <button class="catalog-carousel__nav catalog-carousel__nav--primary" type="button" data-catalog-carousel-next="${escapeAttr(key)}" ${navDisabled}>
              Avançar
            </button>
            <button class="catalog-carousel__nav" type="button" data-catalog-carousel-prev="${escapeAttr(key)}" ${navDisabled}>
              Voltar
            </button>
          </div>
          <span class="catalog-carousel__status" aria-live="polite">Página ${currentPage + 1} de ${pageCount}</span>
        </div>
        <div class="catalog-carousel__viewport">
          <div class="catalog-carousel__track" style="transform: translateX(-${currentPage * 100}%);">
            ${pages}
          </div>
        </div>
      </div>
    `;
  }

  function renderProductPreviewCard(product) {
    const gallery = getProductGallery(product);
    const image = gallery[0] || "";
    const artClass = image ? "product-preview-card__art product-card__art product-card__art--photo" : "product-preview-card__art product-card__art";
    const artStyle = getProductCardStyle(product, image);
    const galleryBadge = gallery.length > 1 ? `<span class="product-card__gallery-count">+${gallery.length - 1} fotos</span>` : "";
    const thumbs = gallery.length > 1
      ? `
        <div class="product-preview-card__thumbs">
          ${gallery
            .map(
              (src, index) => `
                <span class="product-preview-card__thumb ${index === 0 ? "is-active" : ""}" style="background-image:url('${escapeAttr(src)}')" aria-hidden="true"></span>
              `,
            )
            .join("")}
        </div>
      `
      : "";

    return `
      <article class="product-preview-card">
        <div class="product-preview-card__media">
          <div class="${artClass}" ${artStyle}>
            ${
              image
                ? `<span class="product-card__photo-overlay"></span>${galleryBadge}`
                : `<span class="product-card__halo"></span><span class="product-card__silhouette"></span>`
            }
          </div>
          ${thumbs}
        </div>
        <div class="product-preview-card__content">
          <span class="product-card__tag">${escapeHtml(product.featured ? "Destaque" : "Prévia")}</span>
          <h4>${escapeHtml(product.name || "Nome do produto")}</h4>
          <p>${escapeHtml(product.description || "A descrição aparecerá aqui.")}</p>
          <div class="product-preview-card__meta">
            <strong>${formatCurrency(product.price)}</strong>
            <span>${escapeHtml(productMetaLine(product))}</span>
          </div>
        </div>
      </article>
    `;
  }

  function renderProductMediaPreview(product) {
    const gallery = getProductGallery(product);
    const image = gallery[0] || "";
    const artClass = image ? "product-media-field__art product-card__art product-card__art--photo" : "product-media-field__art product-card__art";
    const artStyle = getProductCardStyle(product, image);
    const badgeText = gallery.length > 1 ? `${gallery.length} fotos` : image ? "Foto principal" : "Sem foto";

    const thumbs = gallery.length
      ? gallery
          .map(
            (src, index) => `
              <button
                class="product-media-field__thumb ${index === 0 ? "is-active" : ""}"
                type="button"
                data-product-media-thumb="${escapeAttr(src)}"
                aria-pressed="${index === 0 ? "true" : "false"}"
                aria-label="Selecionar foto ${index + 1}"
                style="background-image:url('${escapeAttr(src)}')"
              ></button>
            `,
          )
          .join("")
      : `
        <div class="product-media-field__empty">
          <strong>Sem fotos ainda</strong>
          <span>Adicione imagens para criar a capa do produto.</span>
        </div>
      `;

    return `
      <div class="product-media-field__preview">
        <div class="${artClass}" ${artStyle}>
          ${
            image
              ? `
                <span class="product-card__photo-overlay"></span>
                <span class="product-media-field__badge">${escapeHtml(badgeText)}</span>
              `
              : `
                <span class="product-card__halo"></span>
                <span class="product-card__silhouette"></span>
                <span class="product-media-field__badge">${escapeHtml(badgeText)}</span>
              `
          }
        </div>
        <div class="product-media-field__thumbs">${thumbs}</div>
        <p class="product-media-field__hint">${escapeHtml(
          gallery.length
            ? "Clique numa miniatura para definir a foto principal. Ao editar, o navegador não repopula o campo de arquivo, mas a galeria salva continua aqui."
            : "A foto escolhida aqui aparecerá no catálogo e na prévia.",
        )}</p>
      </div>
    `;
  }

  async function updateProductPreview(form) {
    if (!form) {
      return;
    }

    const panel = form.closest("[data-crud-panel='products']");
    if (!panel) {
      return;
    }

    const previewCard = panel.querySelector("[data-product-preview-card]");
    const mediaPreview = form.querySelector("[data-product-media-preview]");
    const primaryImageField = form.querySelector('[name="primaryImage"]');

    const token = ++productPreviewRenderToken;
    const draft = await buildProductDraft(form);
    if (token !== productPreviewRenderToken) {
      return;
    }

    if (primaryImageField) {
      primaryImageField.value = draft.image || "";
    }

    if (previewCard) {
      previewCard.innerHTML = renderProductPreviewCard(draft);
    }

    if (mediaPreview) {
      mediaPreview.innerHTML = renderProductMediaPreview(draft);
    }
  }

  function ensureProductLightbox() {
    let modal = document.querySelector("[data-product-lightbox]");
    if (modal) {
      return modal;
    }

    modal = document.createElement("div");
    modal.className = "product-lightbox";
    modal.hidden = true;
    modal.setAttribute("data-product-lightbox", "");
    modal.innerHTML = `
      <div class="product-lightbox__backdrop" data-product-lightbox-close></div>
      <div class="product-lightbox__dialog" role="dialog" aria-modal="true" aria-labelledby="product-lightbox-title">
        <button class="product-lightbox__close" type="button" data-product-lightbox-close aria-label="Fechar fotos">×</button>
        <div class="product-lightbox__stage">
          <button class="product-lightbox__nav product-lightbox__nav--prev" type="button" data-product-lightbox-prev aria-label="Foto anterior">‹</button>
          <div class="product-lightbox__image" data-product-lightbox-image></div>
          <button class="product-lightbox__nav product-lightbox__nav--next" type="button" data-product-lightbox-next aria-label="Próxima foto">›</button>
          <span class="product-lightbox__counter" data-product-lightbox-counter></span>
        </div>
        <div class="product-lightbox__details">
          <span class="product-card__tag" data-product-lightbox-tag></span>
          <h3 id="product-lightbox-title" data-product-lightbox-title></h3>
          <p data-product-lightbox-description></p>
          <div class="product-lightbox__meta">
            <strong data-product-lightbox-price></strong>
            <span data-product-lightbox-info></span>
          </div>
          <div class="product-lightbox__thumbs" data-product-lightbox-thumbs></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    return modal;
  }

  function renderProductLightbox(product, requestedIndex = 0) {
    const modal = ensureProductLightbox();
    const gallery = getProductGallery(product);
    const index = gallery.length ? Math.max(0, Math.min(Number(requestedIndex) || 0, gallery.length - 1)) : 0;
    const image = gallery[index] || gallery[0] || "";
    const imageEl = modal.querySelector("[data-product-lightbox-image]");
    const thumbsEl = modal.querySelector("[data-product-lightbox-thumbs]");
    const prevButton = modal.querySelector("[data-product-lightbox-prev]");
    const nextButton = modal.querySelector("[data-product-lightbox-next]");

    productLightboxState = {
      productId: product.id,
      index,
    };

    modal.hidden = false;
    modal.classList.add("is-open");
    document.body.classList.add("is-lightbox-open");

    imageEl.classList.toggle("product-lightbox__image--empty", !image);
    imageEl.style.backgroundImage = image ? `url("${image.replace(/"/g, '\\"')}")` : "";
    imageEl.style.backgroundSize = getProductImageBackgroundSize(product);
    imageEl.style.backgroundPosition = getProductImagePosition(product);
    imageEl.style.backgroundRepeat = "no-repeat";

    thumbsEl.innerHTML = gallery.length
      ? gallery
          .map(
            (src, thumbIndex) => `
              <button
                type="button"
                class="product-lightbox__thumb ${thumbIndex === index ? "is-active" : ""}"
                data-product-lightbox-thumb="${thumbIndex}"
                style="background-image:url('${escapeAttr(src)}')"
                aria-label="Ver foto ${thumbIndex + 1}"
              ></button>
            `,
          )
          .join("")
      : `
        <div class="empty-state">
          <h3>Sem fotos cadastradas</h3>
          <p>Envie imagens para liberar o carrossel.</p>
        </div>
      `;

    modal.querySelector("[data-product-lightbox-title]").textContent = product.name || "Produto";
    modal.querySelector("[data-product-lightbox-description]").textContent = product.description || "";
    modal.querySelector("[data-product-lightbox-price]").textContent = formatCurrency(product.price);
    modal.querySelector("[data-product-lightbox-tag]").textContent = product.featured ? "Destaque" : "Produto";
    modal.querySelector("[data-product-lightbox-info]").textContent = productMetaLine(product);
    modal.querySelector("[data-product-lightbox-counter]").textContent = gallery.length ? `${index + 1} / ${gallery.length}` : "";

    prevButton.toggleAttribute("disabled", gallery.length <= 1);
    nextButton.toggleAttribute("disabled", gallery.length <= 1);

    window.requestAnimationFrame(() => {
      modal.querySelector("[data-product-lightbox-close]")?.focus();
    });
  }

  function closeProductLightbox() {
    const modal = ensureProductLightbox();
    modal.hidden = true;
    modal.classList.remove("is-open");
    document.body.classList.remove("is-lightbox-open");
    productLightboxState = {
      productId: "",
      index: 0,
    };
  }

  function stepProductLightbox(delta) {
    if (!productLightboxState.productId) {
      return;
    }

    const product = getProducts().find((item) => item.id === productLightboxState.productId);
    if (!product) {
      return;
    }

    const gallery = getProductGallery(product);
    if (!gallery.length) {
      return;
    }

    const nextIndex = (productLightboxState.index + delta + gallery.length) % gallery.length;
    renderProductLightbox(product, nextIndex);
  }

  function openProductLightbox(productId) {
    const product = getProducts().find((item) => item.id === productId);
    if (!product) {
      return;
    }

    renderProductLightbox(product, 0);
  }

  function getCartItems(userId) {
    const carts = getCarts();
    return Array.isArray(carts[userId]) ? carts[userId] : [];
  }

  function saveCartItems(userId, items) {
    const carts = getCarts();
    carts[userId] = items;
    saveCarts(carts);
  }

  function cartSummary(userId) {
    const cartItems = getCartItems(userId);
    const products = getProducts();
    const lines = cartItems.map((item) => {
      const product = products.find((entry) => entry.id === item.productId);
      const price = Number(item.price ?? product?.price ?? 0);
      const quantity = Number(item.quantity) || 0;
      return {
        productId: item.productId,
        name: item.name || product?.name || "Produto removido",
        price,
        quantity,
        subtotal: price * quantity,
        stock: Number(product?.quantity ?? 0),
        image: product?.image || item.image || "",
      };
    });

    const total = lines.reduce((sum, item) => sum + item.subtotal, 0);
    return { lines, total };
  }

  function cartQuantityCount(cartState) {
    return Array.isArray(cartState?.lines)
      ? cartState.lines.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0)
      : 0;
  }

  function getCheckoutDraft() {
    return safeRead(STORAGE_KEYS.checkout, null);
  }

  function saveCheckoutDraft(draft) {
    safeWrite(STORAGE_KEYS.checkout, draft);
  }

  function clearCheckoutDraft() {
    safeRemove(STORAGE_KEYS.checkout);
  }

  function buildCheckoutDraft(userId) {
    const cartState = cartSummary(userId);
    if (!cartState.lines.length) {
      return null;
    }

    return {
      id: uid("checkout"),
      userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      total: cartState.total,
      quantity: cartQuantityCount(cartState),
      items: cartState.lines.map((item) => ({
        productId: item.productId,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        subtotal: item.subtotal,
        stock: item.stock,
        image: item.image,
      })),
    };
  }

  function ensureCheckoutDraft(userId) {
    const cartState = cartSummary(userId);
    const current = getCheckoutDraft();

    const cartSignature = cartState.lines
      .map((item) => [item.productId, item.quantity, item.price, item.subtotal].join(":"))
      .join("|");

    if (current && current.userId === userId && Array.isArray(current.items) && current.items.length) {
      const currentSignature = current.items
        .map((item) => [item.productId, item.quantity, item.price, item.subtotal ?? Number(item.price || 0) * Number(item.quantity || 0)].join(":"))
        .join("|");

      if (currentSignature === cartSignature) {
        return current;
      }
    }

    if (!cartState.lines.length) {
      clearCheckoutDraft();
      return null;
    }

    const next = buildCheckoutDraft(userId);
    if (next) {
      saveCheckoutDraft(next);
    }

    return next;
  }

  function normalizeDigits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function paymentMethodLabel(method, cardType = "") {
    const normalizedMethod = String(method || "").trim();
    if (normalizedMethod === "card") {
      return String(cardType || "").trim() === "debit" ? "Cartão de débito" : "Cartão de crédito";
    }

    if (normalizedMethod === "boleto") {
      return "Boleto";
    }

    return "Pix";
  }

  function paymentPlanLabel(plan, installments = 1) {
    return String(plan || "").trim() === "parcelado" && Number(installments) > 1
      ? `${Math.max(2, Math.round(Number(installments) || 2))}x`
      : "à vista";
  }

  function formatPostalCode(value) {
    const digits = normalizeDigits(value);
    if (digits.length === 8) {
      return digits.replace(/^(\d{5})(\d{3})$/, "$1-$2");
    }

    return digits;
  }

  function formatOrderDocumentSummary(order) {
    const payment = order && typeof order.payment === "object" && order.payment ? order.payment : {};
    const documentType = String(payment.documentType || order.documentType || "").trim().toLowerCase();
    const digits = normalizeDigits(payment.documentNumber || order.documentNumber || "");

    if (!digits) {
      return "Documento não informado";
    }

    const isCnpj = documentType === "cnpj" || digits.length === 14;
    const isCpf = documentType === "cpf" || digits.length === 11 || !isCnpj;

    if (isCnpj) {
      if (digits.length >= 14) {
        return `CNPJ ${digits.slice(0, 14).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}`;
      }

      return `CNPJ ${digits}`;
    }

    if (isCpf && digits.length >= 11) {
      return `CPF ${digits.slice(0, 11).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")}`;
    }

    return `CPF ${digits}`;
  }

  function formatOrderAddressSummary(order) {
    const payment = order && typeof order.payment === "object" && order.payment ? order.payment : {};
    const address = payment.address && typeof payment.address === "object" ? payment.address : order.address && typeof order.address === "object" ? order.address : {};
    const street = String(payment.street || address.street || "").trim();
    const number = String(payment.number || address.number || "").trim();
    const complement = String(payment.complement || address.complement || "").trim();
    const neighborhood = String(payment.neighborhood || address.neighborhood || "").trim();
    const city = String(payment.city || address.city || "").trim();
    const state = String(payment.state || address.state || "").trim().toUpperCase();
    const zipCode = formatPostalCode(payment.zipCode || address.zipCode || "");
    const parts = [];

    if (street || number) {
      parts.push([street, number].filter(Boolean).join(", "));
    }

    if (complement) {
      parts.push(complement);
    }

    const localityParts = [];
    if (neighborhood) {
      localityParts.push(neighborhood);
    }
    if (city || state) {
      localityParts.push([city, state].filter(Boolean).join(" / "));
    }
    if (localityParts.length) {
      parts.push(localityParts.join(" - "));
    }

    if (zipCode) {
      parts.push(`CEP ${zipCode}`);
    }

    return parts.length ? parts.join(" | ") : "Endereço não informado";
  }

  async function copyTextToClipboard(value) {
    const text = String(value || "").trim();
    if (!text) {
      return false;
    }

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (_error) {
      copied = false;
    } finally {
      textarea.remove();
    }

    return copied;
  }

  function getCheckoutProfiles() {
    return safeRead(STORAGE_KEYS.checkoutProfiles, []);
  }

  function saveCheckoutProfiles(items) {
    safeWrite(STORAGE_KEYS.checkoutProfiles, items);
    void syncCollectionToServer("checkout_profiles", items);
  }

  function getCheckoutProfile(checkoutId) {
    const normalizedId = String(checkoutId || "").trim();
    if (!normalizedId) {
      return null;
    }

    return getCheckoutProfiles().find((profile) => String(profile?.id || "").trim() === normalizedId) || null;
  }

  function buildCheckoutProfileDefaults(currentUser, draft, settings = getSettings()) {
    const draftId = String(draft?.id || "").trim();
    const now = new Date().toISOString();

    return {
      id: draftId,
      userId: String(currentUser?.id || "").trim(),
      checkoutId: draftId,
      orderId: "",
      status: "draft",
      createdAt: String(draft?.createdAt || now).trim(),
      updatedAt: String(draft?.updatedAt || now).trim(),
      customerName: String(currentUser?.name || "").trim(),
      documentType: "cpf",
      documentNumber: "",
      phone: "",
      email: String(currentUser?.email || currentUser?.username || "").trim(),
      zipCode: "",
      street: "",
      number: "",
      complement: "",
      neighborhood: "",
      city: "",
      state: "",
      paymentMethod: "pix",
      cardType: "credit",
      paymentPlan: "avista",
      installments: 1,
      cardHolder: String(currentUser?.name || "").trim(),
      cardBrand: "",
      cardLast4: "",
      cardExpiry: "",
      note: "",
      sellerPixKey: String(settings.pixKey || "").trim(),
      sellerPixCode: String(settings.pixCode || "").trim(),
      sellerPixQrCode: String(settings.pixQrCode || "").trim(),
      sellerBoletoCode: String(settings.boletoCode || "").trim(),
      sellerPaymentNote: String(settings.paymentNote || "").trim(),
      paymentLabel: `${paymentMethodLabel("pix", "credit")} • ${paymentPlanLabel("avista", 1)}`,
      paymentPlanLabel: paymentPlanLabel("avista", 1),
    };
  }

  function checkoutProfileFromForm(form, options = {}) {
    const user = getCurrentUser();
    if (!user) {
      return null;
    }

    const formData = new FormData(form);
    const checkoutId = String(formData.get("checkoutId") || options.checkoutId || "").trim();
    if (!checkoutId) {
      return null;
    }

    const existing = getCheckoutProfile(checkoutId);
    const draft = getCheckoutDraft();
    const settings = getSettings();
    const paymentMethod = ["pix", "card", "boleto"].includes(String(formData.get("paymentMethod") || "").trim())
      ? String(formData.get("paymentMethod") || "").trim()
      : "pix";
    const cardType = paymentMethod === "card" && ["debit", "credit"].includes(String(formData.get("cardType") || "").trim())
      ? String(formData.get("cardType") || "").trim()
      : "credit";
    let paymentPlan = ["avista", "parcelado"].includes(String(formData.get("paymentPlan") || "").trim())
      ? String(formData.get("paymentPlan") || "").trim()
      : "avista";
    let installments = Math.max(1, Math.round(parseNumber(formData.get("installments")) || 1));

    if (paymentMethod === "pix" || (paymentMethod === "card" && cardType === "debit")) {
      paymentPlan = "avista";
      installments = 1;
    }

    if (paymentPlan === "parcelado") {
      installments = Math.max(2, installments);
    } else {
      installments = 1;
    }

    const cardNumber = normalizeDigits(formData.get("cardNumber"));
    const paymentLabel = `${paymentMethodLabel(paymentMethod, cardType)} • ${paymentPlanLabel(paymentPlan, installments)}`;

    return {
      ...buildCheckoutProfileDefaults(user, draft, settings),
      ...(existing || {}),
      id: checkoutId,
      userId: user.id,
      checkoutId,
      orderId: String(options.orderId || existing?.orderId || "").trim(),
      status: String(options.status || existing?.status || "draft").trim(),
      createdAt: String(existing?.createdAt || draft?.createdAt || new Date().toISOString()).trim(),
      updatedAt: new Date().toISOString(),
      customerName: String(formData.get("customerName") || user.name || "").trim(),
      documentType: String(formData.get("documentType") || "cpf").trim() || "cpf",
      documentNumber: normalizeDigits(formData.get("documentNumber")),
      phone: String(formData.get("phone") || "").trim(),
      email: String(formData.get("email") || user.email || user.username || "").trim(),
      zipCode: String(formData.get("zipCode") || "").trim(),
      street: String(formData.get("street") || "").trim(),
      number: String(formData.get("number") || "").trim(),
      complement: String(formData.get("complement") || "").trim(),
      neighborhood: String(formData.get("neighborhood") || "").trim(),
      city: String(formData.get("city") || "").trim(),
      state: String(formData.get("state") || "").trim(),
      paymentMethod,
      cardType,
      paymentPlan,
      installments,
      cardHolder: String(formData.get("cardHolder") || user.name || "").trim(),
      cardBrand: paymentMethod === "card" ? String(formData.get("cardBrand") || "").trim() : "",
      cardLast4: paymentMethod === "card" && cardNumber.length >= 4 ? cardNumber.slice(-4) : "",
      cardExpiry: paymentMethod === "card" ? String(formData.get("cardExpiry") || "").trim() : "",
      note: String(formData.get("note") || "").trim(),
      sellerPixKey: String(settings.pixKey || "").trim(),
      sellerPixCode: String(settings.pixCode || "").trim(),
      sellerPixQrCode: String(settings.pixQrCode || "").trim(),
      sellerBoletoCode: String(settings.boletoCode || "").trim(),
      sellerPaymentNote: String(settings.paymentNote || "").trim(),
      paymentLabel,
      paymentPlanLabel: paymentPlanLabel(paymentPlan, installments),
    };
  }

  function saveCheckoutProfileFromForm(form, options = {}) {
    const profile = checkoutProfileFromForm(form, options);
    if (!profile) {
      return null;
    }

    const profiles = getCheckoutProfiles();
    const index = profiles.findIndex((item) => String(item?.id || "").trim() === profile.id);
    if (index >= 0) {
      profiles[index] = profile;
    } else {
      profiles.unshift(profile);
    }

    saveCheckoutProfiles(profiles);
    return profile;
  }

  function getCheckoutFormState(form) {
    const profile = checkoutProfileFromForm(form);
    return profile || null;
  }

  function updateCheckoutPaymentSections(form) {
    if (!form) {
      return;
    }

    const paymentMethod = String(form.querySelector('[name="paymentMethod"]')?.value || "pix").trim();
    const cardType = String(form.querySelector('[name="cardType"]')?.value || "credit").trim();
    const paymentPlan = String(form.querySelector('[name="paymentPlan"]')?.value || "avista").trim();
    const installments = form.querySelector('[name="installments"]');
    const paymentPlanField = form.querySelector('[name="paymentPlan"]');
    const cardPanel = form.querySelector("[data-checkout-card-panel]");
    const cardInstallments = form.querySelector("[data-checkout-installments-panel]");
    const cardTypeField = form.querySelector('[name="cardType"]');
    const cardBrandField = form.querySelector('[name="cardBrand"]');
    const cardNumberField = form.querySelector('[name="cardNumber"]');
    const cardExpiryField = form.querySelector('[name="cardExpiry"]');
    const cardCvvField = form.querySelector('[name="cardCvv"]');

    const cardSelected = paymentMethod === "card";
    const boletoSelected = paymentMethod === "boleto";
    const parceladoSelected = paymentPlan === "parcelado";
    const debitSelected = cardSelected && cardType === "debit";

    if (cardPanel) {
      cardPanel.hidden = !cardSelected;
    }

    if (paymentPlanField) {
      const planLocked = paymentMethod === "pix" || (paymentMethod === "card" && cardType === "debit");
      paymentPlanField.disabled = planLocked;
      if (planLocked) {
        paymentPlanField.value = "avista";
      }
    }

    if (cardInstallments) {
      cardInstallments.hidden = !(parceladoSelected && (cardSelected || boletoSelected));
    }

    if (cardTypeField) {
      cardTypeField.disabled = !cardSelected;
      cardTypeField.toggleAttribute("required", cardSelected);
    }

    if (cardBrandField) {
      cardBrandField.disabled = !cardSelected;
      cardBrandField.toggleAttribute("required", cardSelected);
    }

    if (cardNumberField) {
      cardNumberField.disabled = !cardSelected;
      cardNumberField.toggleAttribute("required", cardSelected);
    }

    if (cardExpiryField) {
      cardExpiryField.disabled = !cardSelected;
      cardExpiryField.toggleAttribute("required", cardSelected);
    }

    if (cardCvvField) {
      cardCvvField.disabled = !cardSelected;
      cardCvvField.toggleAttribute("required", cardSelected);
    }

    if (installments) {
      if (paymentMethod === "pix" || debitSelected || paymentPlan !== "parcelado") {
        installments.value = "1";
        installments.disabled = true;
        installments.toggleAttribute("required", false);
      } else {
        installments.disabled = false;
        installments.toggleAttribute("required", true);
        if (Number(installments.value) < 2) {
          installments.value = "2";
        }
      }
    }
  }

  function scheduleCheckoutProfileSave(form) {
    if (!form) {
      return;
    }

    if (checkoutProfileSyncTimer) {
      window.clearTimeout(checkoutProfileSyncTimer);
    }

    checkoutProfileSyncTimer = window.setTimeout(() => {
      saveCheckoutProfileFromForm(form);
      checkoutProfileSyncTimer = 0;
    }, 240);
  }

  function isCartDialogOpen() {
    return document.body.classList.contains("is-cart-dialog-open");
  }

  function ensureCartDialog() {
    let dialog = document.querySelector("[data-cart-dialog]");
    if (dialog) {
      return dialog;
    }

    dialog = document.createElement("div");
    dialog.className = "cart-dialog";
    dialog.hidden = true;
    dialog.setAttribute("data-cart-dialog", "");
    dialog.innerHTML = `
      <div class="cart-dialog__backdrop" data-cart-dialog-close></div>
      <div class="cart-dialog__dialog" role="dialog" aria-modal="true" aria-labelledby="cart-dialog-title">
        <button type="button" class="cart-dialog__close" data-cart-dialog-close aria-label="Fechar carrinho">×</button>
        <div class="cart-dialog__header">
          <div class="cart-dialog__title-group">
            <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Carrinho de compras</p>
            <h3 id="cart-dialog-title">Carrinho completo</h3>
            <p class="cart-dialog__subtitle">Veja todos os itens, ajuste quantidades, remova produtos e confirme o pedido.</p>
          </div>
          <div class="cart-dialog__header-actions">
            <span class="summary-card__badge" aria-hidden="true" data-cart-dialog-count>0</span>
            <button type="button" class="btn btn--light" data-cart-clear>Limpar carrinho</button>
          </div>
        </div>
        <div class="cart-dialog__body">
          <div class="cart-dialog__content" data-cart-dialog-content></div>
          <aside class="cart-dialog__summary" data-cart-dialog-summary></aside>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    return dialog;
  }

  function renderCartDialogItem(item) {
    const quantity = Number(item.quantity) || 0;
    const itemName = String(item.name || "Produto").trim();
    const productLine = productMetaLine({
      sizes: [],
      categories: [],
      quantity: item.stock,
      active: item.stock > 0,
    });

    return `
      <article class="cart-dialog-item">
        <div class="cart-dialog-item__media">
          ${renderRecordMedia(item, "thumb")}
        </div>
        <div class="cart-dialog-item__body">
          <div class="cart-dialog-item__head">
            <div>
              <p class="cart-dialog-item__eyebrow">Produto</p>
              <h4>${escapeHtml(itemName)}</h4>
              <span class="table-sub">${escapeHtml(productLine)}</span>
            </div>
            <strong class="cart-dialog-item__price">${formatCurrency(item.subtotal)}</strong>
          </div>
          <div class="cart-dialog-item__meta">
            <span><strong>${escapeHtml(quantity)}</strong> unidade${quantity === 1 ? "" : "s"}</span>
            <span><strong>${formatCurrency(item.price)}</strong> cada</span>
            <span><strong>${escapeHtml(item.stock)}</strong> em estoque</span>
          </div>
          <div class="cart-dialog-item__controls">
            <div class="cart-dialog-item__stepper" aria-label="Editar quantidade">
              <button
                type="button"
                class="table-action cart-dialog-item__step-action"
                data-cart-dec="${escapeAttr(item.productId)}"
                aria-label="Diminuir quantidade de ${escapeAttr(itemName)}"
                title="Diminuir quantidade"
              >
                -
              </button>
              <span class="cart-dialog-item__step-count" aria-live="polite">${escapeHtml(quantity)}</span>
              <button
                type="button"
                class="table-action cart-dialog-item__step-action"
                data-cart-inc="${escapeAttr(item.productId)}"
                aria-label="Aumentar quantidade de ${escapeAttr(itemName)}"
                title="Aumentar quantidade"
              >
                +
              </button>
            </div>
            <div class="cart-dialog-item__actions">
              <button type="button" class="table-action" data-cart-view-product="${escapeAttr(item.productId)}">Ver</button>
              <button type="button" class="table-action" data-cart-edit-quantity="${escapeAttr(item.productId)}">Editar</button>
              <button type="button" class="table-action table-action--danger" data-cart-remove="${escapeAttr(item.productId)}">X</button>
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function renderCartDialogList(cartState) {
    const count = cartQuantityCount(cartState);
    const hasItems = cartState.lines.length > 0;

    return `
      <article class="operation-card cart-dialog__list-card">
        <div class="operation-card__header">
          <div>
            <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Itens</p>
            <h3>${hasItems ? "Todos os itens da sacola" : "Seu carrinho está vazio"}</h3>
          </div>
          <span class="summary-card__badge" aria-hidden="true">${escapeHtml(count)}</span>
        </div>
        <div class="cart-preview__notice${cartNotice ? ` ${cartNoticeClass()}` : ""}" data-cart-notice${cartNotice ? "" : " hidden"} aria-live="polite">
          ${cartNotice ? escapeHtml(cartNotice) : ""}
        </div>
        ${
          hasItems
            ? `
              <div class="cart-dialog__list">
                ${cartState.lines.map((item) => renderCartDialogItem(item)).join("")}
              </div>
            `
            : `
              <div class="empty-state cart-dialog__empty">
                <h3>Monte sua sacola</h3>
                <p>Volte ao catálogo e adicione as peças que deseja comprar.</p>
              </div>
            `
        }
      </article>
    `;
  }

  function renderCartDialogSummary(currentUser, cartState) {
    const hasItems = cartState.lines.length > 0;
    const cartCount = cartQuantityCount(cartState);
    const pendingCount = currentUser && isClient(currentUser) ? getPendingOrderCount(getOrders(), currentUser.id) : 0;

    return `
      <article class="operation-card cart-dialog__summary-card">
        <div class="operation-card__header">
          <div>
            <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Resumo</p>
            <h3>Fechar pedido</h3>
          </div>
          <span class="summary-card__badge" aria-hidden="true">${escapeHtml(cartState.lines.length)}</span>
        </div>
        <div class="cart-dialog__stats">
          <span><strong>${escapeHtml(cartState.lines.length)}</strong> itens distintos</span>
          <span><strong>${escapeHtml(cartCount)}</strong> unidades</span>
          ${currentUser && isClient(currentUser) ? `<span><strong>${escapeHtml(pendingCount)}</strong> pedidos em andamento</span>` : ""}
        </div>
        <div class="cart-summary">
          <strong>Total estimado</strong>
          <span>${formatCurrency(cartState.total)}</span>
        </div>
        <div class="crud-form__footer">
          <button type="button" class="btn btn--light" data-cart-go-catalog>Continuar comprando</button>
          ${currentUser && isClient(currentUser) ? `<button type="button" class="btn btn--light" data-cart-go-orders>Ver pedidos</button>` : ""}
          <button type="button" class="btn btn--solid" data-cart-finalize${hasItems ? "" : " disabled"}>Ir para checkout</button>
        </div>
        <div class="crud-form__footer">
          <button type="button" class="btn btn--light" data-cart-clear${hasItems ? "" : " disabled"}>Limpar carrinho</button>
          <button type="button" class="btn btn--light" data-cart-dialog-close>Fechar</button>
        </div>
        <p class="cart-dialog__hint">Ao continuar, você revisa o pagamento antes de o pedido seguir para a vendedora.</p>
      </article>
    `;
  }

  function syncCartDialogState(currentUser) {
    const dialog = document.querySelector("[data-cart-dialog]");
    if (!dialog) {
      return;
    }

    if (!currentUser) {
      dialog.hidden = true;
      dialog.classList.remove("is-open");
      document.body.classList.remove("is-cart-dialog-open");
      document.querySelectorAll("[data-cart-dialog-toggle]").forEach((button) => {
        button.setAttribute("aria-expanded", "false");
      });
      return;
    }

    const cartState = cartSummary(currentUser.id);
    const isOpen = isCartDialogOpen();
    const contentSlot = dialog.querySelector("[data-cart-dialog-content]");
    const summarySlot = dialog.querySelector("[data-cart-dialog-summary]");
    const countSlot = dialog.querySelector("[data-cart-dialog-count]");

    if (contentSlot) {
      contentSlot.innerHTML = renderCartDialogList(cartState);
    }

    if (summarySlot) {
      summarySlot.innerHTML = renderCartDialogSummary(currentUser, cartState);
    }

    if (countSlot) {
      countSlot.textContent = String(cartQuantityCount(cartState));
    }

    dialog.hidden = !isOpen;
    dialog.classList.toggle("is-open", isOpen);

    document.querySelectorAll("[data-cart-dialog-toggle]").forEach((button) => {
      button.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    syncCartNoticeViews();
  }

  function setCartDialogOpen(open) {
    const dialog = ensureCartDialog();
    const isOpen = Boolean(open);
    document.body.classList.toggle("is-cart-dialog-open", isOpen);
    dialog.hidden = !isOpen;
    dialog.classList.toggle("is-open", isOpen);

    document.querySelectorAll("[data-cart-dialog-toggle]").forEach((button) => {
      button.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
  }

  function openCartDialog() {
    const currentUser = getCurrentUser();
    if (!currentUser) {
      openAccess("cliente.html");
      return;
    }

    if (document.body.classList.contains("is-lightbox-open")) {
      closeProductLightbox();
    }
    setCartDialogOpen(true);
    syncCartDialogState(currentUser);
    window.requestAnimationFrame(() => {
      ensureCartDialog().querySelector("[data-cart-dialog-close]")?.focus();
    });
  }

  function closeCartDialog(restoreFocus = true) {
    const currentToggle = document.querySelector("[data-cart-dialog-toggle]");
    setCartDialogOpen(false);
    const dialog = document.querySelector("[data-cart-dialog]");
    if (dialog) {
      dialog.hidden = true;
    }

    if (restoreFocus) {
      currentToggle?.focus({ preventScroll: true });
    }
  }

  function getCartFlightSourceRect(triggerEl) {
    const card = triggerEl ? triggerEl.closest(".product-card") : null;
    const sourceEl = card?.querySelector(".product-card__art") || triggerEl || null;
    const rect = sourceEl?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) {
      return null;
    }

    return rect;
  }

  function animateCartFlight(sourceRect, product) {
    if (!sourceRect) {
      return;
    }

    const cartButton = document.querySelector("[data-topbar-cart]");
    if (!cartButton) {
      return;
    }

    const targetRect = cartButton.getBoundingClientRect();
    if (!targetRect.width || !targetRect.height) {
      return;
    }

    const flyerSize = Math.max(52, Math.min(88, Math.max(sourceRect.width, sourceRect.height) * 0.72));
    const startLeft = sourceRect.left + sourceRect.width / 2 - flyerSize / 2;
    const startTop = sourceRect.top + sourceRect.height / 2 - flyerSize / 2;
    const targetLeft = targetRect.left + targetRect.width / 2 - flyerSize / 2;
    const targetTop = targetRect.top + targetRect.height / 2 - flyerSize / 2;
    const dx = targetLeft - startLeft;
    const dy = targetTop - startTop;
    const flyer = document.createElement("div");
    flyer.className = "cart-flight";
    flyer.style.width = `${flyerSize}px`;
    flyer.style.height = `${flyerSize}px`;
    flyer.style.left = `${startLeft}px`;
    flyer.style.top = `${startTop}px`;
    flyer.style.setProperty("--cart-flight-dx", `${dx}px`);
    flyer.style.setProperty("--cart-flight-dy", `${dy}px`);

    if (product?.image) {
      flyer.style.backgroundImage = `url("${String(product.image).replace(/"/g, '\\"')}")`;
    } else {
      flyer.classList.add("cart-flight--empty");
    }

    document.body.appendChild(flyer);
    cartButton.classList.add("is-pulsing");

    window.requestAnimationFrame(() => {
      flyer.classList.add("is-flying");
    });

    window.setTimeout(() => {
      flyer.remove();
      cartButton.classList.remove("is-pulsing");
    }, 820);
  }

  function addToCart(productId, triggerEl) {
    const user = getCurrentUser();
    if (!user) {
      openAccess("cliente.html");
      return;
    }

    const products = getProducts();
    const product = products.find((entry) => entry.id === productId);
    if (!product || !product.active || Number(product.quantity) <= 0) {
      return;
    }

    const carts = getCarts();
    const items = Array.isArray(carts[user.id]) ? carts[user.id] : [];
    const existing = items.find((item) => item.productId === productId);
    const nextQuantity = existing ? existing.quantity + 1 : 1;
    const cappedQuantity = Math.min(nextQuantity, Number(product.quantity) || 0);

    if (existing) {
      existing.quantity = cappedQuantity;
    } else {
      items.push({
        productId,
        quantity: cappedQuantity,
        name: product.name,
        price: Number(product.price) || 0,
        image: product.image || "",
      });
    }

    carts[user.id] = items;
    saveCarts(carts);
    const productLabel = String(product.name || "Produto").trim();
    setCartNotice(`${productLabel} foi adicionado ao carrinho.`, "success");
    const sourceRect = getCartFlightSourceRect(triggerEl);
    refreshVisibleUi();
    window.requestAnimationFrame(() => {
      animateCartFlight(sourceRect, product);
    });
  }

  function changeCartItem(productId, delta) {
    const user = getCurrentUser();
    if (!user) {
      return;
    }

    const carts = getCarts();
    const items = Array.isArray(carts[user.id]) ? carts[user.id] : [];
    const item = items.find((entry) => entry.productId === productId);
    if (!item) {
      return;
    }

    const product = getProducts().find((entry) => entry.id === productId);
    const max = Number(product?.quantity) || 0;
    const currentQuantity = Number(item.quantity) || 0;
    const nextQuantity = Math.min(Math.max(0, currentQuantity + delta), max || currentQuantity);
    item.quantity = nextQuantity;

    carts[user.id] = items.filter((entry) => entry.quantity > 0);
    saveCarts(carts);
    refreshVisibleUi();
  }

  function removeCartItem(productId) {
    const user = getCurrentUser();
    if (!user) {
      return;
    }

    const carts = getCarts();
    const items = Array.isArray(carts[user.id]) ? carts[user.id] : [];
    carts[user.id] = items.filter((item) => item.productId !== productId);
    saveCarts(carts);
    refreshVisibleUi();
  }

  async function editCartItemQuantity(productId) {
    const user = getCurrentUser();
    if (!user) {
      return;
    }

    const carts = getCarts();
    const items = Array.isArray(carts[user.id]) ? carts[user.id] : [];
    const item = items.find((entry) => entry.productId === productId);
    if (!item) {
      return;
    }

    const product = getProducts().find((entry) => entry.id === productId);
    const max = Number(product?.quantity) || Number(item.quantity) || 0;
    const currentQuantity = Number(item.quantity) || 0;
    const response = await showUiPrompt(`Atualize a quantidade de ${String(item.name || "produto").trim()}.`, {
      title: "Editar quantidade",
      inputLabel: "Quantidade",
      inputHint: "Digite um número inteiro. Se o valor for zero, o item será removido do carrinho.",
      defaultValue: String(currentQuantity),
      inputType: "number",
      min: "0",
      step: "1",
      confirmLabel: "Salvar",
      cancelLabel: "Cancelar",
      tone: "accent",
    });

    if (response === null) {
      return;
    }

    const desiredQuantity = Math.floor(Number(String(response).replace(",", ".")));
    if (!Number.isFinite(desiredQuantity)) {
      await showUiAlert("Digite uma quantidade válida.", {
        title: "Quantidade inválida",
        tone: "danger",
      });
      return;
    }

    const nextQuantity = Math.min(Math.max(0, desiredQuantity), max || desiredQuantity);
    if (nextQuantity <= 0) {
      removeCartItem(productId);
      return;
    }

    item.quantity = nextQuantity;
    carts[user.id] = items.filter((entry) => entry.quantity > 0);
    saveCarts(carts);
    refreshVisibleUi();
  }

  async function clearCartItems() {
    const user = getCurrentUser();
    if (!user) {
      openAccess("checkout.html");
      return;
    }

    const carts = getCarts();
    const items = Array.isArray(carts[user.id]) ? carts[user.id] : [];
    if (!items.length) {
      setCartNotice("Seu carrinho já está vazio.", "success");
      refreshVisibleUi();
      return;
    }

    const confirmed = await showUiConfirm("Limpar o carrinho e remover todos os itens em montagem?", {
      title: "Limpar carrinho",
      confirmLabel: "Limpar carrinho",
      cancelLabel: "Manter itens",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }

    carts[user.id] = [];
    saveCarts(carts);
    setCartNotice("Carrinho limpo. Você pode montar um novo pedido.", "success");
    refreshVisibleUi();
  }

  function finalizeOrder() {
    const user = getCurrentUser();
    if (!user) {
      openAccess("checkout.html");
      return;
    }

    const cart = getCartItems(user.id);
    if (!cart.length) {
      setCartNotice("Seu carrinho está vazio. Escolha ao menos um produto para continuar.", "error");
      refreshVisibleUi();
      return;
    }

    const checkoutDraft = ensureCheckoutDraft(user.id);
    if (!checkoutDraft) {
      setCartNotice("Seu carrinho está vazio. Escolha ao menos um produto para continuar.", "error");
      refreshVisibleUi();
      return;
    }

    saveCheckoutDraft({
      ...checkoutDraft,
      updatedAt: new Date().toISOString(),
    });
    closeCartDialog(false);
    goTo(pageLink("checkout.html"));
  }

  async function completeCheckoutPayment(form) {
    const user = getCurrentUser();
    if (!user) {
      openAccess("checkout.html");
      return;
    }

    const draft = ensureCheckoutDraft(user.id);
    if (!draft || !Array.isArray(draft.items) || !draft.items.length) {
      await showUiAlert("Seu checkout está vazio. Volte ao carrinho para escolher produtos.", {
        title: "Checkout vazio",
        tone: "danger",
      });
      return;
    }

    if (typeof form.reportValidity === "function" && !form.reportValidity()) {
      return;
    }

    const savedProfile = saveCheckoutProfileFromForm(form, {
      status: "draft",
    });
    if (!savedProfile) {
      await showUiAlert("Não foi possível salvar os dados do checkout. Tente novamente.", {
        title: "Checkout inválido",
        tone: "danger",
      });
      return;
    }

    if (savedProfile.paymentMethod === "pix" && !savedProfile.sellerPixKey && !savedProfile.sellerPixCode && !savedProfile.sellerPixQrCode) {
      await showUiAlert("A vendedora ainda não configurou Pix para este checkout. Peça os dados de pagamento antes de continuar.", {
        title: "Pix indisponível",
        tone: "danger",
      });
      return;
    }

    if (savedProfile.paymentMethod === "boleto" && !savedProfile.sellerBoletoCode) {
      await showUiAlert("A vendedora ainda não configurou o boleto para este checkout.", {
        title: "Boleto indisponível",
        tone: "danger",
      });
      return;
    }

    const products = getProducts();
    const nextProducts = products.map((product) => ({ ...product }));

    const availabilityIssue = draft.items.some((item) => {
      const product = nextProducts.find((entry) => entry.id === item.productId);
      return !product || !product.active || Number(product.quantity) < Number(item.quantity);
    });

    if (availabilityIssue) {
      await showUiAlert("Alguns itens mudaram de estoque. Volte ao carrinho para revisar a sacola.", {
        title: "Estoque atualizado",
        tone: "danger",
      });
      saveCheckoutDraft({
        ...draft,
        updatedAt: new Date().toISOString(),
      });
      refreshVisibleUi();
      return;
    }

    const orderItems = draft.items.map((item) => {
      const product = nextProducts.find((entry) => entry.id === item.productId);

      if (product) {
        product.quantity = Math.max(0, Number(product.quantity) - Number(item.quantity));
        product.active = Number(product.quantity) > 0;
      }

      return {
        productId: item.productId,
        name: item.name || product?.name || "Produto removido",
        price: Number(item.price ?? product?.price ?? 0),
        quantity: Number(item.quantity) || 0,
      };
    });

    saveProducts(nextProducts);

    const orders = getOrders();
    const total = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const orderId = uid("order");
    const finalProfile = saveCheckoutProfileFromForm(form, {
      status: "paid",
      orderId,
    }) || savedProfile;

    orders.unshift({
      id: orderId,
      userId: user.id,
      userName: user.name,
      checkoutId: draft.id,
      customerName: finalProfile.customerName || user.name,
      documentType: finalProfile.documentType || "cpf",
      documentNumber: finalProfile.documentNumber || "",
      phone: finalProfile.phone || "",
      email: finalProfile.email || "",
      address: {
        zipCode: finalProfile.zipCode || "",
        street: finalProfile.street || "",
        number: finalProfile.number || "",
        complement: finalProfile.complement || "",
        neighborhood: finalProfile.neighborhood || "",
        city: finalProfile.city || "",
        state: finalProfile.state || "",
      },
      paymentMethod: finalProfile.paymentMethod || "pix",
      cardType: finalProfile.cardType || "",
      paymentPlan: finalProfile.paymentPlan || "avista",
      installments: Number(finalProfile.installments) || 1,
      cardHolder: finalProfile.cardHolder || "",
      cardBrand: finalProfile.cardBrand || "",
      cardLast4: finalProfile.cardLast4 || "",
      cardExpiry: finalProfile.cardExpiry || "",
      paymentLabel: finalProfile.paymentLabel || paymentMethodLabel(finalProfile.paymentMethod, finalProfile.cardType),
      payment: finalProfile,
      note: finalProfile.note || "",
      items: orderItems,
      total,
      status: "Pago",
      paidAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    });
    saveOrders(orders);

    const carts = getCarts();
    carts[user.id] = [];
    saveCarts(carts);
    clearCheckoutDraft();
    closeCartDialog(false);
    refreshVisibleUi();

    await showUiAlert(
      `O pagamento foi confirmado e o pedido foi enviado para a vendedora com o status Pago.${finalProfile.paymentLabel ? ` Forma de pagamento: ${finalProfile.paymentLabel}.` : ""}`,
      {
        title: "Pagamento aprovado",
        tone: "success",
        confirmLabel: "Ver meus pedidos",
        eyebrow: "Pedido enviado",
      },
    );

    goTo(pageLink("cliente.html", "meus-pedidos"));
  }

  function updateOrderStatus(orderId, nextStatus) {
    const orders = getOrders();
    const order = orders.find((item) => item.id === orderId);
    if (!order) {
      return false;
    }

    order.status = normalizeOrderStatus(nextStatus);
    saveOrders(orders);
    return true;
  }

  async function saveOrUpdateUser(form) {
    const formData = new FormData(form);
    const users = getUsers();
    const currentUser = getCurrentUser();
    if (!currentUser || !isAdmin(currentUser)) {
      throw new Error("Apenas administradores podem gerenciar usuários.");
    }
    const id = String(formData.get("id") || "").trim();
    const existing = id ? users.find((user) => user.id === id) : null;
    const username = normalizeUsername(formData.get("username"));
    const emailInput = normalizeEmail(formData.get("email"));
    const email = emailInput || existing?.email || "";
    const role = normalizeUserRole(formData.get("role"));
    const image = await collectSingleImageState(form, existing, {
      fileInputName: "imageFile",
    });
    const nextUser = {
      id: existing?.id || uid("user"),
      name: String(formData.get("name") || "").trim(),
      email,
      username,
      password: String(formData.get("password") || "").trim(),
      role,
      image,
      mustChangePassword: false,
    };

    if (!nextUser.name || !nextUser.username || !nextUser.password) {
      throw new Error("Preencha nome, usuário e senha.");
    }

    const duplicate = users.find((user) => {
      if (user.id === nextUser.id) {
        return false;
      }

      const usernameMatch = normalizeUsername(user.username) === nextUser.username;
      const emailMatch = nextUser.email && normalizeEmail(user.email) === nextUser.email;
      return usernameMatch || emailMatch;
    });
    if (duplicate) {
      throw new Error("Já existe outro usuário com esse email ou login.");
    }

    if (existing && existing.role === "admin" && nextUser.role !== "admin") {
      const adminCount = users.filter((user) => user.role === "admin").length;
      if (adminCount <= 1) {
        throw new Error("Mantenha pelo menos um administrador ativo.");
      }
    }

    if (existing) {
      Object.assign(existing, nextUser);
    } else {
      users.unshift(nextUser);
    }

    await saveUsers(users);
  }

  async function registerClientUser(form) {
    const formData = new FormData(form);
    const users = getUsers();
    const name = String(formData.get("name") || "").trim();
    const email = normalizeEmail(formData.get("email"));
    const username = normalizeUsername(formData.get("username"));
    const password = String(formData.get("password") || "").trim();
    const confirmPassword = String(formData.get("confirmPassword") || "").trim();

    if (!name || !email || !username || !password || !confirmPassword) {
      throw new Error("Preencha nome, email, usuário e senha.");
    }

    if (password !== confirmPassword) {
      throw new Error("As senhas não coincidem.");
    }

    const duplicate = users.find((user) => {
      const usernameMatch = normalizeUsername(user.username) === username;
      const emailMatch = normalizeEmail(user.email) === email;
      return usernameMatch || emailMatch;
    });

    if (duplicate) {
      throw new Error("Já existe um usuário com esse email ou login.");
    }

    const image = await collectSingleImageState(form, null, {
      fileInputName: "imageFile",
    });

    const user = {
      id: uid("user"),
      name,
      email,
      username,
      password,
      role: "cliente",
      image,
      mustChangePassword: false,
    };

    users.unshift(user);
    await saveUsers(users);
    return user;
  }

  async function saveOrUpdateSupplier(form) {
    const formData = new FormData(form);
    const suppliers = getSuppliers();
    const id = String(formData.get("id") || "").trim();
    const existing = id ? suppliers.find((item) => item.id === id) : null;
    const image = await collectSingleImageState(form, existing, {
      fileInputName: "imageFile",
    });
    const next = {
      id: existing?.id || uid("supplier"),
      name: String(formData.get("name") || "").trim(),
      contact: String(formData.get("contact") || "").trim(),
      category: String(formData.get("category") || "").trim(),
      note: String(formData.get("note") || "").trim(),
      image,
    };

    if (!next.name) {
      throw new Error("Preencha o nome do fornecedor.");
    }

    if (existing) {
      Object.assign(existing, next);
    } else {
      suppliers.unshift(next);
    }

    saveSuppliers(suppliers);
  }

  async function saveOrUpdateEmployee(form) {
    const formData = new FormData(form);
    const employees = getEmployees();
    const id = String(formData.get("id") || "").trim();
    const existing = id ? employees.find((item) => item.id === id) : null;
    const image = await collectSingleImageState(form, existing, {
      fileInputName: "imageFile",
    });
    const next = {
      id: existing?.id || uid("employee"),
      name: String(formData.get("name") || "").trim(),
      role: String(formData.get("role") || "").trim(),
      contact: String(formData.get("contact") || "").trim(),
      shift: String(formData.get("shift") || "").trim(),
      image,
    };

    if (!next.name) {
      throw new Error("Preencha o nome do funcionário.");
    }

    if (existing) {
      Object.assign(existing, next);
    } else {
      employees.unshift(next);
    }

    saveEmployees(employees);
  }

  async function saveOrUpdateProduct(form) {
    const products = getProducts();
    const id = String(form.querySelector('[name="id"]')?.value || "").trim();
    const existing = id ? products.find((product) => product.id === id) : null;
    const nextProduct = await buildProductDraft(form);

    if (!nextProduct.name || !nextProduct.description) {
      throw new Error("Preencha nome e descrição do produto.");
    }

    if (existing) {
      Object.assign(existing, nextProduct);
    } else {
      products.unshift(nextProduct);
    }

    saveProducts(products);
    const idField = form.querySelector('[name="id"]');
    if (idField) {
      idField.value = nextProduct.id;
    }

    setProductSaveNotice(
      existing
        ? "Produto atualizado com sucesso. A foto e os ajustes foram enviados ao banco."
        : "Produto salvo com sucesso. A foto e os ajustes foram enviados ao banco.",
    );
  }

  function saveStoreSettings(form) {
    const formData = new FormData(form);
    const next = {
      whatsapp: String(formData.get("whatsapp") || "").trim(),
      phone: String(formData.get("phone") || "").trim(),
      email: String(formData.get("email") || "").trim(),
      address: String(formData.get("address") || "").trim(),
      instagram: String(formData.get("instagram") || "").trim(),
      note: String(formData.get("note") || "").trim(),
      pixKey: String(formData.get("pixKey") || "").trim(),
      pixCode: String(formData.get("pixCode") || "").trim(),
      pixQrCode: String(formData.get("pixQrCode") || "").trim(),
      boletoCode: String(formData.get("boletoCode") || "").trim(),
      paymentNote: String(formData.get("paymentNote") || "").trim(),
    };

    saveSettings(next);
  }

  function deleteById(collection, id) {
    return collection.filter((item) => item.id !== id);
  }

  function renderUserRows(users) {
    if (!users.length) {
      return `
        <tr>
          <td colspan="6">
            <div class="empty-state">
              <h3>Sem usuários cadastrados</h3>
              <p>Crie o primeiro login usando o formulário acima.</p>
            </div>
          </td>
        </tr>
      `;
    }

    return users
      .map(
        (user) => `
          <tr>
            <td>
              ${renderRecordMedia(user, "avatar")}
            </td>
            <td>
              <strong>${escapeHtml(user.name)}</strong>
              <span class="table-sub">${escapeHtml(user.mustChangePassword ? "Conta padrão" : "Conta ativa")}</span>
            </td>
            <td>${escapeHtml(user.email || "Sem email")}</td>
            <td>@${escapeHtml(user.username)}</td>
            <td><span class="status-pill ${user.role === "admin" ? "status-pill--accent" : ""}">${user.role === "admin" ? "Administrador" : "Cliente"}</span></td>
            <td class="table-actions">
              <button type="button" class="table-action" data-crud-edit="users" data-id="${escapeAttr(user.id)}">Editar</button>
              <button type="button" class="table-action table-action--danger" data-crud-delete="users" data-id="${escapeAttr(user.id)}">Excluir</button>
            </td>
          </tr>
        `,
      )
      .join("");
  }

  function renderProductRows(products) {
    if (!products.length) {
      return `
        <tr>
          <td colspan="8">
            <div class="empty-state">
              <h3>Sem produtos cadastrados</h3>
              <p>Adicione peças para que elas apareçam na home e no catálogo.</p>
            </div>
          </td>
        </tr>
      `;
    }

    return products
      .map(
        (product) => `
          <tr>
            <td>
              ${renderRecordMedia(product, "thumb")}
            </td>
            <td>
              <strong>${escapeHtml(product.name)}</strong>
              <span class="table-sub">${escapeHtml(product.description)}</span>
            </td>
            <td>${escapeHtml((Array.isArray(product.categories) ? product.categories : []).join(", ") || "Sem categoria")}</td>
            <td>${formatCurrency(product.price)}</td>
            <td>${escapeHtml(product.quantity)}</td>
            <td>${escapeHtml((Array.isArray(product.sizes) ? product.sizes : []).join(", ") || "Único")}</td>
            <td><span class="status-pill ${product.active ? "status-pill--accent" : "status-pill--muted"}">${product.active ? "Ativo" : "Inativo"}</span></td>
            <td class="table-actions">
              <button type="button" class="table-action" data-crud-edit="products" data-id="${escapeAttr(product.id)}">Editar</button>
              <button type="button" class="table-action table-action--danger" data-crud-delete="products" data-id="${escapeAttr(product.id)}">Excluir</button>
            </td>
          </tr>
        `,
      )
      .join("");
  }

  function renderSupplierRows(items) {
    if (!items.length) {
      return `
        <tr>
          <td colspan="6">
            <div class="empty-state">
              <h3>Sem fornecedores cadastrados</h3>
              <p>Cadastre parceiros para organizar a reposição.</p>
            </div>
          </td>
        </tr>
      `;
    }

    return items
      .map(
        (item) => `
          <tr>
            <td>${renderRecordMedia(item, "avatar")}</td>
            <td><strong>${escapeHtml(item.name)}</strong></td>
            <td>${escapeHtml(item.contact)}</td>
            <td>${escapeHtml(item.category)}</td>
            <td>${escapeHtml(item.note)}</td>
            <td class="table-actions">
              <button type="button" class="table-action" data-crud-edit="suppliers" data-id="${escapeAttr(item.id)}">Editar</button>
              <button type="button" class="table-action table-action--danger" data-crud-delete="suppliers" data-id="${escapeAttr(item.id)}">Excluir</button>
            </td>
          </tr>
        `,
      )
      .join("");
  }

  function renderEmployeeRows(items) {
    if (!items.length) {
      return `
        <tr>
          <td colspan="6">
            <div class="empty-state">
              <h3>Sem funcionários cadastrados</h3>
              <p>Cadastre a equipe para acompanhar operação e turnos.</p>
            </div>
          </td>
        </tr>
      `;
    }

    return items
      .map(
        (item) => `
          <tr>
            <td>${renderRecordMedia(item, "avatar")}</td>
            <td><strong>${escapeHtml(item.name)}</strong></td>
            <td>${escapeHtml(item.role)}</td>
            <td>${escapeHtml(item.contact)}</td>
            <td>${escapeHtml(item.shift)}</td>
            <td class="table-actions">
              <button type="button" class="table-action" data-crud-edit="employees" data-id="${escapeAttr(item.id)}">Editar</button>
              <button type="button" class="table-action table-action--danger" data-crud-delete="employees" data-id="${escapeAttr(item.id)}">Excluir</button>
            </td>
          </tr>
        `,
      )
      .join("");
  }

  function renderCartItemActionButtons(item) {
    const itemName = escapeAttr(item.name || "Produto");

    return `
      <button
        type="button"
        class="table-action"
        data-cart-dec="${escapeAttr(item.productId)}"
        aria-label="Diminuir quantidade de ${itemName}"
        title="Diminuir quantidade"
      >
        -
      </button>
      <button
        type="button"
        class="table-action"
        data-cart-inc="${escapeAttr(item.productId)}"
        aria-label="Aumentar quantidade de ${itemName}"
        title="Aumentar quantidade"
      >
        +
      </button>
      <button
        type="button"
        class="table-action table-action--danger"
        data-cart-remove="${escapeAttr(item.productId)}"
        aria-label="Remover ${itemName} do carrinho"
        title="Remover do carrinho"
      >
        X
      </button>
    `;
  }

  function renderCartRows(lines) {
    if (!lines.length) {
      return `
        <tr>
          <td colspan="6">
            <div class="empty-state">
              <h3>O carrinho está vazio</h3>
              <p>Escolha produtos no catálogo para montar o pedido.</p>
            </div>
          </td>
        </tr>
      `;
    }

    return lines
      .map(
        (item) => `
          <tr>
            <td>
              ${renderRecordMedia(item, "thumb")}
            </td>
            <td>
              <strong>${escapeHtml(item.name)}</strong>
              <span class="table-sub">${escapeHtml(productMetaLine({
                sizes: [],
                categories: [],
                quantity: item.stock,
                active: item.stock > 0,
              }))}</span>
            </td>
            <td>${escapeHtml(item.quantity)}</td>
            <td>${formatCurrency(item.price)}</td>
            <td>${formatCurrency(item.subtotal)}</td>
            <td class="table-actions">
              ${renderCartItemActionButtons(item)}
            </td>
          </tr>
        `,
      )
      .join("");
  }

  function renderClientOrdersRows(items) {
    if (!items.length) {
      return `
        <div class="empty-state">
          <h3>Sem pedidos ainda</h3>
          <p>Complete sua compra para que os pedidos apareçam aqui.</p>
        </div>
      `;
    }

    return items
      .map(
        (order) => `
          <article class="order-item">
            <div class="order-item__head">
              <div>
                <strong>Pedido ${escapeHtml(order.id.slice(0, 12))}</strong>
                <span class="table-sub">${escapeHtml(formatOrderDate(order.createdAt))}${order.paymentLabel ? ` • ${escapeHtml(order.paymentLabel)}` : ""}</span>
              </div>
              <span class="${orderStatusClass(order.status)}">${escapeHtml(normalizeOrderStatus(order.status))}</span>
            </div>
            <p>${escapeHtml(orderItemsSummary(order.items))}</p>
            <div class="order-item__meta">
              <strong>${formatCurrency(order.total)}</strong>
              <span>${escapeHtml(order.items.length)} item${order.items.length === 1 ? "" : "s"}</span>
            </div>
          </article>
        `,
      )
      .join("");
  }

  function renderSellerOrdersRows(items) {
    if (!items.length) {
      return `
        <div class="empty-state">
          <h3>Sem pedidos recebidos</h3>
          <p>Os pedidos enviados pela cliente vão aparecer aqui em tempo real.</p>
        </div>
      `;
    }

    return items
      .map(
        (order) => `
          <article class="order-item order-item--editor">
            <div class="order-item__head">
              <div>
                <strong>Pedido ${escapeHtml(order.id.slice(0, 12))}</strong>
                <span class="table-sub">${escapeHtml(order.userName || "Cliente")} • ${escapeHtml(formatOrderDate(order.createdAt))}${order.paymentLabel ? ` • ${escapeHtml(order.paymentLabel)}` : ""}</span>
              </div>
              <span class="${orderStatusClass(order.status)}">${escapeHtml(normalizeOrderStatus(order.status))}</span>
            </div>
            <p>${escapeHtml(orderItemsSummary(order.items))}</p>
            <div class="order-item__details">
              <span>${escapeHtml(formatOrderDocumentSummary(order))}</span>
              <span>${escapeHtml(formatOrderAddressSummary(order))}</span>
            </div>
            <div class="order-item__meta">
              <strong>${formatCurrency(order.total)}</strong>
              <span>${escapeHtml(order.items.length)} item${order.items.length === 1 ? "" : "s"}</span>
            </div>
            <label class="field order-status-field">
              <span>Atualizar status</span>
              <select data-order-status-select data-order-id="${escapeAttr(order.id)}">
                ${ORDER_STATUSES.map((status) => `
                  <option value="${escapeAttr(status)}"${normalizeOrderStatus(order.status) === status ? " selected" : ""}>${escapeHtml(status)}</option>
                `).join("")}
              </select>
            </label>
          </article>
        `,
      )
      .join("");
  }

  function renderOrderStatusSummary(items) {
    const counts = getOrderStatusCounts(items);
    const latest = Array.isArray(items) && items.length ? items[0] : null;
    return `
      <article class="sidebar-card sidebar-card--compact">
        <div class="sidebar-card__head">
          <div>
            <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Status</p>
            <h3>Resumo dos pedidos</h3>
          </div>
          <span class="sidebar-card__badge" aria-hidden="true">${escapeHtml(items.length)}</span>
        </div>
        <div class="sidebar-card__status-list">
          ${counts
            .map(
              (item) => `
                <div class="sidebar-card__status-row">
                  <span class="status-pill status-pill--${escapeAttr(item.tone)}">${escapeHtml(item.label)}</span>
                  <strong>${escapeHtml(item.value)}</strong>
                </div>
              `,
            )
            .join("")}
        </div>
      </article>
      <article class="sidebar-card sidebar-card--compact sidebar-card--soft">
        <div class="sidebar-card__head">
          <div>
            <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Último pedido</p>
            <h3>${latest ? normalizeOrderStatus(latest.status) : "Sem pedidos"}</h3>
          </div>
          <span class="sidebar-card__badge" aria-hidden="true">•</span>
        </div>
        <p>${latest ? orderItemsSummary(latest.items, 2) : "Os pedidos finalizados aparecerão aqui."}</p>
        <div class="sidebar-card__stats">
          <span><strong>${latest ? formatCurrency(latest.total) : formatCurrency(0)}</strong> último total</span>
          <span><strong>${escapeHtml(items.length)}</strong> pedidos no total</span>
        </div>
      </article>
    `;
  }

  function renderCartPreview(cartState, userOrders) {
    const latestOrder = Array.isArray(userOrders) && userOrders.length ? userOrders[0] : null;
    const previewItems = cartState.lines.slice(0, 4);
    const hasItems = cartState.lines.length > 0;
    return `
      <div class="cart-preview">
        <div class="operation-card__header">
          <div>
            <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Ao vivo</p>
            <h3>Carrinho em tempo real</h3>
          </div>
          <span class="summary-card__badge" aria-hidden="true">${escapeHtml(cartState.lines.length)}</span>
        </div>
        <div class="cart-preview__notice${cartNotice ? ` ${cartNoticeClass()}` : ""}" data-cart-notice${cartNotice ? "" : " hidden"} aria-live="polite">
          ${cartNotice ? escapeHtml(cartNotice) : ""}
        </div>
        <div class="cart-preview__body">
          ${
            hasItems
              ? `
                <ul class="cart-preview__list">
                  ${previewItems
                    .map(
                      (item) => `
                        <li class="cart-preview__item">
                          <div class="cart-preview__item-main">
                            <div>
                              <strong>${escapeHtml(item.name)}</strong>
                              <span>${escapeHtml(item.quantity)} unidade${Number(item.quantity) === 1 ? "" : "s"}</span>
                            </div>
                            <strong>${formatCurrency(item.subtotal)}</strong>
                          </div>
                          <div class="cart-preview__actions">
                            ${renderCartItemActionButtons(item)}
                          </div>
                        </li>
                      `,
                    )
                    .join("")}
                </ul>
                ${cartState.lines.length > previewItems.length ? `<p class="cart-preview__more">+${cartState.lines.length - previewItems.length} item(ns) adicionais</p>` : ""}
              `
              : `
                <div class="empty-state">
                  <h3>Seu carrinho está vazio</h3>
                  <p>Escolha produtos no catálogo para montar a compra em tempo real.</p>
                </div>
              `
          }
        </div>
        <div class="cart-summary">
          <strong>Total estimado</strong>
          <span>${formatCurrency(cartState.total)}</span>
        </div>
        <div class="crud-form__footer">
          <button type="button" class="btn btn--light" data-cart-clear${hasItems ? "" : " disabled"}>Limpar carrinho</button>
          <button type="button" class="btn btn--solid" data-cart-finalize${hasItems ? "" : " disabled"}>Ir para checkout</button>
        </div>
        <p class="cart-preview__hint">Você revisa tudo no checkout antes de o pedido entrar no painel da vendedora.</p>
        ${latestOrder ? `<p class="cart-preview__latest">Último pedido: <strong>${escapeHtml(normalizeOrderStatus(latestOrder.status))}</strong></p>` : ""}
      </div>
    `;
  }

  function chartBars(items) {
    if (!items.length) {
      return `
        <div class="empty-state">
          <h3>Sem dados suficientes</h3>
          <p>Os gráficos serão preenchidos conforme os cadastros e pedidos crescerem.</p>
        </div>
      `;
    }

    const max = Math.max(...items.map((item) => item.value), 1);
    return items
      .map((item) => {
        const percent = Math.max(6, Math.round((item.value / max) * 100));
        return `
          <div class="chart-bars__row">
            <div class="chart-bars__label">
              <strong>${escapeHtml(item.label)}</strong>
              <span>${escapeHtml(item.helper || "")}</span>
            </div>
            <div class="chart-bars__track">
              <span class="chart-bars__fill" style="width:${percent}%"></span>
            </div>
            <strong class="chart-bars__value">${escapeHtml(item.value)}</strong>
          </div>
        `;
      })
      .join("");
  }

  function dashboardMetrics(users, products, orders) {
    const totalStock = products.reduce((sum, product) => sum + (Number(product.quantity) || 0), 0);
    const totalRevenue = orders.reduce((sum, order) => sum + (Number(order.total) || 0), 0);
    const activeOrders = orders.length;
    const adminUsers = users.filter((user) => user.role === "admin").length;

    return [
      { label: "Usuários", value: users.length, helper: `${adminUsers} admin(s)` },
      { label: "Produtos", value: products.length, helper: `${products.filter((product) => product.active).length} ativos` },
      { label: "Pedidos", value: activeOrders, helper: "Histórico geral" },
      { label: "Receita", value: formatCurrency(totalRevenue), helper: `${totalStock} peças em estoque` },
    ];
  }

  function categoryChartData(products) {
    const map = new Map();
    products.forEach((product) => {
      const categories = Array.isArray(product.categories) && product.categories.length ? product.categories : [firstCategory(product)];
      categories.slice(0, 2).forEach((category) => {
        map.set(category, (map.get(category) || 0) + 1);
      });
    });

    return [...map.entries()]
      .map(([label, value]) => ({ label, value, helper: "Produtos" }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }

  function orderChartData(orders) {
    const statusMap = new Map();
    orders.forEach((order) => {
      const status = order.status || "Recebido";
      statusMap.set(status, (statusMap.get(status) || 0) + 1);
    });

    return [...statusMap.entries()]
      .map(([label, value]) => ({ label, value, helper: "Pedidos" }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }

  function currentHash(defaultHash, allowedHashes = []) {
    const hash = String(window.location.hash || "").trim();
    if (hash && (!allowedHashes.length || allowedHashes.includes(hash))) {
      return hash;
    }

    return defaultHash;
  }

  function avatarSeedFromString(value) {
    return String(value || "")
      .split("")
      .reduce((acc, char) => (acc + char.charCodeAt(0)) % 360, 0);
  }

  function getUserAvatarSource(user) {
    return String(user?.avatar || user?.photo || user?.image || "").trim();
  }

  function userAvatarLabel(user) {
    const name = String(user?.name || user?.username || "Perfil").trim();
    if (!name) {
      return "PF";
    }

    const parts = name.split(/\s+/).filter(Boolean);
    if (!parts.length) {
      return "PF";
    }

    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }

    return `${parts[0][0] || "P"}${parts[parts.length - 1][0] || "F"}`.toUpperCase();
  }

  function userRoleLabel(user) {
    return isAdmin(user) ? "Vendedora" : "Cliente";
  }

  function renderUserAvatar(user, size = "md") {
    const avatarSource = getUserAvatarSource(user);
    const avatarLabel = userAvatarLabel(user);
    const style = avatarSource
      ? ""
      : `style="--avatar-hue:${avatarSeedFromString(user?.name || user?.username || user?.id || avatarLabel)};"`;

    return `
      <span class="profile-avatar profile-avatar--${escapeAttr(size)}${avatarSource ? " profile-avatar--photo" : ""}" ${style} aria-hidden="true">
        ${avatarSource ? `<img class="profile-avatar__image" src="${escapeAttr(avatarSource)}" alt="" decoding="async" />` : escapeHtml(avatarLabel)}
      </span>
    `;
  }

  function getUserProfileSummary(currentUser, orders, cartState = null) {
    const currentOrders = Array.isArray(orders) ? orders : [];
    const isClientUser = isClient(currentUser);
    const roleLabel = userRoleLabel(currentUser);
    const resolvedCartState = isClientUser ? cartState || cartSummary(currentUser.id) : null;
    const cartCount = isClientUser ? cartQuantityCount(resolvedCartState) : 0;
    const pendingCount = isClientUser
      ? getPendingOrderCount(currentOrders, currentUser.id)
      : getPendingOrderCount(currentOrders);
    const totalOrders = isClientUser
      ? currentOrders.filter((order) => order?.userId === currentUser.id).length
      : currentOrders.length;
    const activeProducts = getProducts().filter((product) => product?.active !== false).length;
    const summaryRows = isClientUser
      ? [
          { value: cartCount, label: "Itens no carrinho" },
          { value: pendingCount, label: "Pedidos em andamento" },
          { value: totalOrders, label: "Pedidos totais" },
        ]
      : [
          { value: pendingCount, label: "Pedidos pendentes" },
          { value: activeProducts, label: "Produtos ativos" },
          { value: totalOrders, label: "Pedidos recebidos" },
        ];

    return {
      isClientUser,
      roleLabel,
      cartCount,
      pendingCount,
      totalOrders,
      activeProducts,
      summaryRows,
      cartState: resolvedCartState,
    };
  }

  function getRecordImageSource(record) {
    return String(record?.image || record?.avatar || record?.photo || "").trim();
  }

  function recordInitials(record) {
    const source = String(record?.name || record?.title || record?.username || record?.id || "Item").trim();
    if (!source) {
      return "IT";
    }

    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }

    return `${parts[0][0] || "I"}${parts[parts.length - 1][0] || "T"}`.toUpperCase();
  }

  function renderRecordMedia(record, shape = "avatar") {
    const imageSource = getRecordImageSource(record);
    const initials = recordInitials(record);
    const labelSource = String(record?.name || record?.username || record?.title || record?.id || initials).trim();
    const style = imageSource
      ? `style="background-image:url('${escapeAttr(imageSource)}');"`
      : `style="--record-hue:${avatarSeedFromString(labelSource)};"`;

    return `
      <span class="record-media record-media--${escapeAttr(shape)}${imageSource ? " record-media--photo" : ""}" ${style} aria-hidden="true">
        ${imageSource ? "" : escapeHtml(initials)}
      </span>
    `;
  }

  function setLocationHash(hash) {
    const nextHash = String(hash || "").trim();
    if (!nextHash) {
      return;
    }

    const normalizedHash = nextHash.startsWith("#") ? nextHash : `#${nextHash}`;

    if (window.history && typeof window.history.replaceState === "function") {
      window.history.replaceState(null, "", normalizedHash);
      window.dispatchEvent(new Event("hashchange"));
      return;
    }

    window.location.hash = normalizedHash.slice(1);
  }

  function defaultMenuHash(page = currentPageName()) {
    switch (page) {
      case "index.html":
        return "#inicio";
      case "cliente.html":
        return "#inicio";
      case "vendedora.html":
        return "#painel";
      case "catalogo.html":
        return "#catalogo";
      default:
        return "";
    }
  }

  function allowedMenuHashes(page = currentPageName()) {
    switch (page) {
      case "index.html":
        return ["#inicio", "#sobre", "#contato"];
      case "cliente.html":
        return ["#inicio", "#catalogo", "#carrinho", "#meus-pedidos", "#sobre", "#contato"];
      case "vendedora.html":
        return ["#painel", "#pedidos", "#cadastros", "#estoque", "#contato"];
      case "catalogo.html":
        return ["#catalogo"];
      default:
        return [];
    }
  }

  function currentMenuHash(page = currentPageName()) {
    return currentHash(defaultMenuHash(page), allowedMenuHashes(page));
  }

  function pageLink(page, hash = "") {
    const targetHash = String(hash || "").trim().replace(/^#/, "");
    if (!targetHash) {
      return page;
    }

    return currentPageName() === page ? `#${targetHash}` : `${page}#${targetHash}`;
  }

  function topbarCartHref() {
    const page = currentPageName();
    if (page === "cliente.html" || page === "catalogo.html") {
      return "#carrinho";
    }

    return pageLink("cliente.html", "carrinho");
  }

  function topbarCheckoutHref() {
    return pageLink("checkout.html");
  }

  function isMenuLinkActive(href) {
    const targetUrl = new URL(String(href || "#"), window.location.href);
    const targetPage = pageNameFromPath(targetUrl.pathname);
    const currentPage = currentPageName();

    if (targetPage !== currentPage) {
      return false;
    }

    if (!targetUrl.hash) {
      return true;
    }

    return targetUrl.hash === currentMenuHash(currentPage);
  }

  function syncMenuNavigationState() {
    document.querySelectorAll(".portal-nav__link, .topbar .nav__link, .sidebar__nav a").forEach((link) => {
      const href = String(link.getAttribute("href") || "");
      const isActive = isMenuLinkActive(href);
      link.classList.toggle("is-active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function shouldOpenSidebarByDefault() {
    return window.matchMedia("(min-width: 1181px)").matches;
  }

  function getSidebarOpenState() {
    const stored = safeRead(STORAGE_KEYS.sidebarUI, null);
    return typeof stored === "boolean" ? stored : shouldOpenSidebarByDefault();
  }

  function syncSidebarMetrics() {
    const topbar = document.querySelector(".topbar");
    const height = topbar ? Math.ceil(topbar.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty("--topbar-height", `${height || 44}px`);
  }

  function syncSidebarToggleControls(open = document.body.classList.contains("is-sidebar-open")) {
    document.querySelectorAll("[data-sidebar-toggle]").forEach((button) => {
      button.setAttribute("aria-expanded", open ? "true" : "false");
      button.setAttribute("aria-label", open ? "Fechar menu lateral" : "Abrir menu lateral");
      button.classList.toggle("is-active", open);
    });
  }

  function setSidebarOpen(open, persist = true) {
    const isOpen = Boolean(open);
    document.body.classList.toggle("is-sidebar-open", isOpen);
    document.body.dataset.sidebarOpen = isOpen ? "true" : "false";

    if (isOpen) {
      setProfilePopoverOpen(false);
    }

    if (persist) {
      safeWrite(STORAGE_KEYS.sidebarUI, isOpen);
    }

    syncSidebarToggleControls(isOpen);
    syncCatalogStageControls();
  }

  function initializeSidebarState() {
    if (!document.querySelector("[data-sidebar-toggle]")) {
      return;
    }

    syncSidebarMetrics();
    setSidebarOpen(getSidebarOpenState(), false);
  }

  function bindSidebarToggleActions() {
    if (document.body.dataset.sidebarToggleBound === "1") {
      return;
    }

    document.body.dataset.sidebarToggleBound = "1";

    document.addEventListener("click", async (event) => {
      const toggle = event.target.closest("[data-sidebar-toggle]");
      if (toggle) {
        event.preventDefault();
        setSidebarOpen(!document.body.classList.contains("is-sidebar-open"));
        return;
      }

      const backdrop = event.target.closest("[data-sidebar-backdrop]");
      if (backdrop) {
        event.preventDefault();
        setSidebarOpen(false);
        return;
      }

      if (!document.body.classList.contains("is-sidebar-open")) {
        return;
      }

      const sidebar = document.querySelector(".portal-sidebar");
      if (sidebar && sidebar.contains(event.target)) {
        return;
      }

      setSidebarOpen(false);
    });

    window.addEventListener("resize", () => {
      syncSidebarMetrics();
      syncCatalogStageControls();
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.body.classList.contains("is-sidebar-open")) {
        setSidebarOpen(false);
      }
    });
  }

  function bindUiDialogActions() {
    if (document.body.dataset.uiDialogBound === "1") {
      return;
    }

    document.body.dataset.uiDialogBound = "1";

    document.addEventListener("click", async (event) => {
      const cancel = event.target.closest("[data-ui-dialog-cancel]");
      if (!cancel) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      closeUiDialog(uiDialogState.mode === "prompt" ? null : false);
    });

    document.addEventListener("submit", (event) => {
      const form = event.target.closest("[data-ui-dialog-form]");
      if (!form) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      const input = form.querySelector("[data-ui-dialog-input]");
      if (uiDialogState.mode === "prompt") {
        closeUiDialog(String(input?.value ?? ""));
        return;
      }

      closeUiDialog(true);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !isUiDialogOpen()) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();
      closeUiDialog(uiDialogState.mode === "prompt" ? null : false);
    });
  }

  function bindCatalogScrollActions() {
    if (document.body.dataset.catalogScrollBound === "1") {
      return;
    }

    document.body.dataset.catalogScrollBound = "1";

    document.addEventListener(
      "wheel",
      (event) => {
        const horizontalArea = event.target.closest(".catalog-rail, .catalog-carousel__page");
        if (!horizontalArea) {
          return;
        }

        const maxScrollLeft = horizontalArea.scrollWidth - horizontalArea.clientWidth;
        if (maxScrollLeft <= 0) {
          return;
        }

        const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
        if (!delta) {
          return;
        }

        const nextScrollLeft = Math.min(Math.max(0, horizontalArea.scrollLeft + delta), maxScrollLeft);
        if (nextScrollLeft === horizontalArea.scrollLeft) {
          return;
        }

        horizontalArea.scrollLeft = nextScrollLeft;
        event.preventDefault();
      },
      { passive: false },
    );
  }

  function catalogStageButtonTemplate(direction) {
    const isPrev = direction < 0;

    return `
      <button
        type="button"
        class="catalog-stage__nav catalog-stage__nav--${isPrev ? "prev" : "next"}"
        data-catalog-stage-${isPrev ? "prev" : "next"}
        aria-label="${isPrev ? "Voltar no catálogo" : "Avançar no catálogo"}"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="${isPrev ? "M15 6 9 12l6 6" : "M9 6l6 6-6 6"}" />
        </svg>
      </button>
    `;
  }

  function stepCatalogStage(stage, delta) {
    if (!stage) {
      return;
    }

    const carousel = stage.querySelector("[data-catalog-carousel]");
    if (carousel) {
      const scope = carousel.getAttribute("data-catalog-scope");
      stepCatalogCarousel(scope, delta);
      return;
    }

    const rail = stage.querySelector(".catalog-rail");
    if (!rail) {
      return;
    }

    const step = Math.max(Math.round(rail.clientWidth * 0.84), 260);
    rail.scrollBy({
      left: delta * step,
      behavior: "smooth",
    });
  }

  function syncCatalogStageControls() {
    document.querySelectorAll(".catalog-rail").forEach((rail) => {
      let stage = rail.closest("[data-catalog-stage]");

      if (!stage) {
        stage = document.createElement("div");
        stage.className = "catalog-stage";
        stage.dataset.catalogStage = "true";
        rail.parentNode.insertBefore(stage, rail);
        stage.appendChild(rail);
        stage.insertAdjacentHTML("beforeend", catalogStageButtonTemplate(-1));
        stage.insertAdjacentHTML("beforeend", catalogStageButtonTemplate(1));
      }

      const carousel = rail.querySelector("[data-catalog-carousel]");
      const hasScrollableContent = carousel
        ? carousel.querySelectorAll(".catalog-carousel__page").length > 1
        : rail.scrollWidth > rail.clientWidth + 2;
      const isActive = Boolean(hasScrollableContent);

      stage.dataset.catalogStageMode = carousel ? "carousel" : "rail";
      stage.dataset.catalogStageScrollable = isActive ? "true" : "false";
      stage.querySelectorAll("[data-catalog-stage-prev], [data-catalog-stage-next]").forEach((button) => {
        button.disabled = !isActive;
      });
    });
  }

  function renderNavSvg(kind) {
    const icons = {
      home: `
        <path d="M4 11.5 12 5l8 6.5" />
        <path d="M6.5 10.5V19h11v-8.5" />
        <path d="M10 19v-5h4v5" />
      `,
      summary: `
        <path d="M4 19V5" />
        <path d="M8 19v-8" />
        <path d="M12 19v-12" />
        <path d="M16 19v-6" />
        <path d="M20 19V9" />
      `,
      catalog: `
        <path d="M4 7.5 12 4l8 3.5v9L12 20l-8-3.5v-9Z" />
        <path d="M4 7.5 12 11l8-3.5" />
        <path d="M12 11v9" />
      `,
      cart: `
        <path d="M6 6h15l-1.5 9h-13z" />
        <path d="M6 6 5 3H2" />
        <circle cx="9" cy="20" r="1.5" />
        <circle cx="18" cy="20" r="1.5" />
      `,
      orders: `
        <rect x="5" y="4" width="14" height="16" rx="2" />
        <path d="M9 4.5V3h6v1.5" />
        <path d="M9 10h6" />
        <path d="M9 14h6" />
      `,
      info: `
        <circle cx="12" cy="12" r="9" />
        <path d="M12 10v6" />
        <path d="M12 7.2h.01" />
      `,
      contact: `
        <path d="M4.5 6.5 8.5 4l2.4 3.9-1.7 1.6c1 2.1 2.6 3.7 4.7 4.7l1.6-1.7 3.9 2.4-2.5 4c-.4.7-1.2 1.1-2 1-6.6-.8-11.8-6-12.6-12.6-.1-.8.3-1.6 1-2Z" />
      `,
      dashboard: `
        <path d="M4 19V5" />
        <path d="M8 19v-5" />
        <path d="M12 19v-9" />
        <path d="M16 19v-7" />
        <path d="M20 19v-12" />
      `,
      stock: `
        <path d="M12 3 20 7v10l-8 4-8-4V7l8-4Z" />
        <path d="M12 7v14" />
        <path d="M4 7l8 4 8-4" />
      `,
      user: `
        <path d="M12 14a5 5 0 1 0-5-5 5 5 0 0 0 5 5Z" />
        <path d="M4 20a8 8 0 0 1 16 0" />
      `,
      arrow: `
        <path d="M5 12h12" />
        <path d="M13 6l6 6-6 6" />
      `,
      logout: `
        <path d="M10 17l5-5-5-5" />
        <path d="M15 12H3" />
        <path d="M21 3v18" />
      `,
    };

    return `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        ${icons[kind] || icons.arrow}
      </svg>
    `;
  }

  function renderNavIcon(kind) {
    if (!kind) {
      return "";
    }

    return `<span class="portal-nav__icon" aria-hidden="true">${renderNavSvg(kind)}</span>`;
  }

  function renderButtonIcon(kind) {
    if (!kind) {
      return "";
    }

    return `<span class="btn__icon" aria-hidden="true">${renderNavSvg(kind)}</span>`;
  }

  function renderPortalLink(
    label,
    href,
    description,
    active = false,
    badge = "",
    alert = false,
    icon = "",
    directWhatsApp = false,
  ) {
    const fallbackHref = escapeAttr(href);

    return `
      <a class="portal-nav__link${active ? " is-active" : ""}${alert ? " portal-nav__link--alert" : ""}" href="${fallbackHref}"${active ? ' aria-current="page"' : ""}${directWhatsApp ? ` data-whatsapp-link data-whatsapp-fallback="${fallbackHref}"` : ""}>
        <span class="portal-nav__content">
          ${renderNavIcon(icon)}
          <span class="portal-nav__copy">
            <span class="portal-nav__title">
              <span class="portal-nav__title-text">${escapeHtml(label)}</span>
              ${badge ? `<span class="portal-nav__badge">${escapeHtml(badge)}</span>` : ""}
            </span>
            ${description ? `<small>${escapeHtml(description)}</small>` : ""}
          </span>
        </span>
      </a>
    `;
  }

  function renderSidebarMenu(items, ariaLabel) {
    return `
      <nav class="portal-nav" aria-label="${escapeAttr(ariaLabel)}">
        ${(Array.isArray(items) ? items : [])
          .map((item) =>
            renderPortalLink(
              item.label,
              item.href,
              item.description,
              false,
              item.badge || "",
              Boolean(item.alert),
              item.icon || "",
              Boolean(item.whatsapp),
            ),
          )
          .join("")}
      </nav>
    `;
  }

  function buildPublicMenuLinks(currentUser) {
    const links = [
      {
        label: "Início",
        href: "index.html",
        description: "Página principal",
        icon: "home",
      },
      {
        label: "Catálogo",
        href: "catalogo.html",
        description: "Ver peças",
        icon: "catalog",
      },
    ];

    if (currentUser) {
      if (isAdmin(currentUser)) {
        const pendingCount = getPendingOrderCount(getOrders());
        links.push(
          {
            label: "Área da cliente",
            href: "cliente.html",
            description: "Abrir a conta da cliente",
            icon: "user",
          },
          {
            label: "Painel",
            href: "vendedora.html",
            description: "Operação da loja",
            icon: "dashboard",
          },
          {
            label: "Pedidos",
            href: pageLink("vendedora.html", "pedidos"),
            description: "Fila de atendimento",
            icon: "orders",
            badge: pendingCount ? String(pendingCount) : "",
            alert: pendingCount > 0,
          },
          {
            label: "Cadastros",
            href: pageLink("vendedora.html", "cadastros"),
            description: "CRUD interno",
            icon: "user",
          },
          {
            label: "Estoque",
            href: pageLink("vendedora.html", "estoque"),
            description: "Produtos ativos",
            icon: "stock",
          },
        );
      } else if (isClient(currentUser)) {
        const cartState = cartSummary(currentUser.id);
        const userOrders = getOrders().filter((order) => order.userId === currentUser.id);
        const cartCount = cartQuantityCount(cartState);
        const pendingCount = getPendingOrderCount(userOrders, currentUser.id);
        links.push(
          {
            label: "Minha área",
            href: "cliente.html",
            description: "Abrir sua conta",
            icon: "user",
          },
          {
            label: "Carrinho",
            href: pageLink("cliente.html", "carrinho"),
            description: "Montar pedido",
            icon: "cart",
            badge: cartCount ? String(cartCount) : "",
            alert: cartCount > 0,
          },
          {
            label: "Meus pedidos",
            href: pageLink("cliente.html", "meus-pedidos"),
            description: "Acompanhar status",
            icon: "orders",
            badge: pendingCount ? String(pendingCount) : "",
            alert: pendingCount > 0,
          },
        );
      }
    } else {
      links.push({
        label: "Acesso",
        href: "acesso.html",
        description: "Entrar ou cadastrar",
        icon: "arrow",
      });
    }

    links.push(
      {
        label: "Sobre",
        href: pageLink("index.html", "sobre"),
        description: "Conhecer a loja",
        icon: "info",
      },
      {
        label: "Contato",
        href: pageLink("index.html", "contato"),
        description: "Falar com a equipe",
        icon: "contact",
        whatsapp: true,
      },
    );

    return links;
  }

  function buildClientMenuLinks(currentUser, cartState, orders) {
    const currentOrders = Array.isArray(orders) ? orders : [];
    const cartCount = cartQuantityCount(cartState);
    const pendingCount = getPendingOrderCount(currentOrders, currentUser.id);

    return [
      {
        label: "Início",
        href: "index.html",
        description: "Voltar à home",
        icon: "home",
      },
      {
        label: "Resumo",
        href: "#inicio",
        description: "Visão geral",
        icon: "summary",
      },
      {
        label: "Catálogo",
        href: "#catalogo",
        description: "Ver produtos",
        icon: "catalog",
      },
      {
        label: "Carrinho",
        href: "#carrinho",
        description: "Montar pedido",
        icon: "cart",
        badge: cartCount ? String(cartCount) : "",
        alert: cartCount > 0,
      },
      {
        label: "Checkout",
        href: "checkout.html",
        description: "Dados e pagamento",
        icon: "summary",
        badge: cartCount ? String(cartCount) : "",
        alert: cartCount > 0,
      },
      {
        label: "Meus pedidos",
        href: "#meus-pedidos",
        description: "Acompanhar status",
        icon: "orders",
        badge: pendingCount ? String(pendingCount) : "",
        alert: pendingCount > 0,
      },
      {
        label: "Sobre",
        href: "#sobre",
        description: "Conhecer a loja",
        icon: "info",
      },
      {
        label: "Contato",
        href: "#contato",
        description: "Falar com a equipe",
        icon: "contact",
        whatsapp: true,
      },
    ];
  }

  function buildSellerMenuLinks(orders) {
    const pendingCount = getPendingOrderCount(orders);

    return [
      {
        label: "Início",
        href: "index.html",
        description: "Voltar à home",
        icon: "home",
      },
      {
        label: "Painel",
        href: "#painel",
        description: "Visão geral",
        icon: "dashboard",
      },
      {
        label: "Pedidos",
        href: "#pedidos",
        description: "Fila de atendimento",
        icon: "orders",
        badge: pendingCount ? String(pendingCount) : "",
        alert: pendingCount > 0,
      },
      {
        label: "Cadastros",
        href: "#cadastros",
        description: "CRUD interno",
        icon: "user",
      },
      {
        label: "Estoque",
        href: "#estoque",
        description: "Produtos ativos",
        icon: "stock",
      },
      {
        label: "Área da cliente",
        href: "cliente.html",
        description: "Abrir a conta da cliente",
        icon: "user",
      },
      {
        label: "Catálogo",
        href: "catalogo.html",
        description: "Ver a vitrine",
        icon: "catalog",
      },
      {
        label: "Sobre",
        href: pageLink("index.html", "sobre"),
        description: "Conhecer a loja",
        icon: "info",
      },
      {
        label: "Contato",
        href: "#contato",
        description: "Configurações da loja",
        icon: "contact",
        whatsapp: true,
      },
    ];
  }

  function renderProfilePopover(currentUser, cartState, orders) {
    const summary = getUserProfileSummary(currentUser, orders, cartState);
    const currentPage = currentPageName();
    const profileTargetHref = isAdmin(currentUser)
      ? (currentPage === "vendedora.html" ? "#pedidos" : "vendedora.html")
      : (currentPage === "cliente.html" ? "#carrinho" : "catalogo.html");
    const profileTargetLabel = isAdmin(currentUser)
      ? (currentPage === "vendedora.html" ? "Ver pedidos" : "Abrir painel interno")
      : (currentPage === "cliente.html" ? "Abrir carrinho" : "Ver catálogo");
    const profileTargetIcon = isAdmin(currentUser)
      ? (currentPage === "vendedora.html" ? "orders" : "dashboard")
      : (currentPage === "cliente.html" ? "cart" : "catalog");

    return `
      <div class="profile-popover" id="topbar-profile-popover" role="dialog" aria-modal="false" aria-labelledby="topbar-profile-popover-title" data-profile-popover${document.body.classList.contains("is-profile-open") ? "" : " hidden"}>
        <article class="sidebar-card sidebar-card--accent profile-popover__card">
          <div class="sidebar-card__head profile-popover__head">
            <div class="profile-popover__identity">
              ${renderUserAvatar(currentUser, "md")}
              <div class="profile-popover__copy">
                <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Perfil</p>
                <h3 id="topbar-profile-popover-title">${escapeHtml(currentUser.name)}</h3>
                <span>${escapeHtml(summary.roleLabel)} • ${escapeHtml(currentUser.email || currentUser.username || "Conta ativa")}</span>
              </div>
            </div>
            <button type="button" class="profile-popover__close" data-profile-close aria-label="Fechar perfil">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M6 6l12 12" />
                <path d="M18 6 6 18" />
              </svg>
            </button>
          </div>
          <div class="profile-popover__meta">
            <span><strong>${escapeHtml(currentUser.username || "sem login")}</strong> login</span>
            <span><strong>${escapeHtml(summary.roleLabel)}</strong> perfil</span>
            <span><strong>${escapeHtml(summary.isClientUser ? summary.cartCount : summary.activeProducts)}</strong> ${escapeHtml(summary.isClientUser ? "itens" : "produtos")}</span>
          </div>
          <div class="sidebar-card__stats profile-popover__stats">
            ${summary.summaryRows
              .map(
                (row) => `
                  <span><strong>${escapeHtml(row.value)}</strong> ${escapeHtml(row.label)}</span>
                `,
              )
              .join("")}
          </div>
          <div class="sidebar-card__actions profile-popover__actions">
            <a class="btn btn--solid" href="${escapeAttr(profileTargetHref)}">
              ${renderButtonIcon(profileTargetIcon)}
              <span>${escapeHtml(profileTargetLabel)}</span>
            </a>
            <button type="button" class="btn btn--light" data-action="logout">
              ${renderButtonIcon("logout")}
              <span>Sair</span>
            </button>
          </div>
        </article>
      </div>
    `;
  }

  function renderSidebarProfileCard(currentUser, orders) {
    if (!currentUser) {
      return "";
    }

    const summary = getUserProfileSummary(currentUser, orders);
    const profileOpen = document.body.classList.contains("is-profile-open");

    return `
      <article class="sidebar-card sidebar-card--accent sidebar-profile">
        <div class="sidebar-card__head sidebar-profile__head">
          <div class="sidebar-profile__identity">
            ${renderUserAvatar(currentUser, "lg")}
            <div class="sidebar-profile__copy">
              <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Perfil</p>
              <h3>${escapeHtml(currentUser.name)}</h3>
              <span>${escapeHtml(summary.roleLabel)} • ${escapeHtml(currentUser.email || currentUser.username || "Conta ativa")}</span>
            </div>
          </div>
        </div>
        <div class="sidebar-profile__stats">
          ${summary.summaryRows
            .map(
              (row) => `
                <span><strong>${escapeHtml(row.value)}</strong> ${escapeHtml(row.label)}</span>
              `,
            )
            .join("")}
        </div>
        <div class="sidebar-card__actions">
          <button
            type="button"
            class="btn btn--solid"
            data-profile-toggle="topbar-profile"
            aria-controls="topbar-profile-popover"
            aria-haspopup="dialog"
            aria-expanded="${profileOpen ? "true" : "false"}"
            aria-label="Abrir perfil de ${escapeAttr(currentUser.name)}"
          >
            ${renderButtonIcon("user")}
            <span>Abrir perfil</span>
          </button>
          <button type="button" class="btn btn--light" data-action="logout">
            ${renderButtonIcon("logout")}
            <span>Sair</span>
          </button>
        </div>
      </article>
    `;
  }

  function syncSidebarProfile(currentUser, orders) {
    document.querySelectorAll(".sidebar, .portal-sidebar").forEach((sidebar) => {
      let profileSlot = sidebar.querySelector("[data-sidebar-profile-slot]");

      if (!currentUser) {
        profileSlot?.remove();
        return;
      }

      if (!profileSlot) {
        profileSlot = document.createElement("div");
        profileSlot.className = "sidebar__profile";
        profileSlot.setAttribute("data-sidebar-profile-slot", "1");

        const header = sidebar.querySelector(".sidebar__header");
        if (header) {
          header.insertAdjacentElement("afterend", profileSlot);
        } else {
          sidebar.prepend(profileSlot);
        }
      }

      if (!profileSlot) {
        return;
      }

      profileSlot.innerHTML = renderSidebarProfileCard(currentUser, orders);
    });
  }

  function renderClientSidebar(currentUser, cartState, orders) {
    const items = buildClientMenuLinks(currentUser, cartState, orders);

    return `
      <aside class="portal-sidebar" id="client-sidebar-menu" aria-label="Menu da cliente">
        ${renderSidebarMenu(items, "Atalhos da cliente")}
      </aside>
    `;
  }

  function renderSellerSidebar(currentUser, orders, products) {
    const items = buildSellerMenuLinks(orders);

    return `
      <aside class="portal-sidebar" id="seller-sidebar-menu" aria-label="Menu da vendedora">
        ${renderSidebarMenu(items, "Atalhos da vendedora")}
      </aside>
    `;
  }

  function renderPublicSidebar(currentUser) {
    const items = buildPublicMenuLinks(currentUser);

    document.querySelectorAll("[data-site-menu-shell]").forEach((sidebar) => {
      sidebar.innerHTML = renderSidebarMenu(items, "Atalhos do site");
    });
  }

  function renderSellerManagementRail(users, products, suppliers, employees, activeTab) {
    const tabInfo = {
      users: {
        title: "Usuários",
        text: "Ajuste permissões e organize quem entra na operação.",
      },
      products: {
        title: "Produtos",
        text: "Atualize fotos, quantidade e vitrine sem perder o ritmo.",
      },
      suppliers: {
        title: "Fornecedores",
        text: "Mantenha a reposição viva com contatos sempre à mão.",
      },
      employees: {
        title: "Funcionários",
        text: "Veja a equipe e os turnos para cobrir o atendimento.",
      },
      contact: {
        title: "Contato",
        text: "Deixe WhatsApp, telefone e canais da loja sempre corretos.",
      },
    };
    const current = tabInfo[activeTab] || tabInfo.users;

    return `
      <article class="sidebar-card sidebar-card--compact">
        <div class="sidebar-card__head">
          <div>
            <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Aba ativa</p>
            <h3>${escapeHtml(current.title)}</h3>
          </div>
          <span class="sidebar-card__badge" aria-hidden="true">${escapeHtml(activeTab === "contact" ? "!" : ">")}</span>
        </div>
        <p>${escapeHtml(current.text)}</p>
        <div class="sidebar-card__actions">
          <button type="button" class="btn btn--solid" data-scroll-target="${escapeAttr(activeTab)}">
            ${renderButtonIcon("arrow")}
            <span>Abrir aba</span>
          </button>
          <a class="btn btn--light" href="#pedidos">
            ${renderButtonIcon("orders")}
            <span>Ver pedidos</span>
          </a>
        </div>
      </article>
      <article class="sidebar-card sidebar-card--soft">
        <div class="sidebar-card__head">
          <div>
            <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Cadastros</p>
            <h3>Volume geral</h3>
          </div>
          <span class="sidebar-card__badge" aria-hidden="true">${escapeHtml(users.length + products.length + suppliers.length + employees.length)}</span>
        </div>
        <div class="sidebar-card__stats">
          <span><strong>${escapeHtml(users.length)}</strong> usuários</span>
          <span><strong>${escapeHtml(products.length)}</strong> produtos</span>
          <span><strong>${escapeHtml(suppliers.length)}</strong> fornecedores</span>
          <span><strong>${escapeHtml(employees.length)}</strong> funcionários</span>
        </div>
      </article>
    `;
  }

  function renderSellerContactSummary(settings) {
    const whatsapp = formatWhatsAppDisplay(settings.whatsapp || settings.phone || STORE_WHATSAPP_DISPLAY);
    const email = String(settings.email || "").trim();
    const instagram = String(settings.instagram || "").trim();
    const pixKey = String(settings.pixKey || "").trim();
    const pixCode = String(settings.pixCode || "").trim();
    const pixQrCode = String(settings.pixQrCode || "").trim();
    const boletoCode = String(settings.boletoCode || "").trim();

    return `
      <article class="sidebar-card sidebar-card--compact">
        <div class="sidebar-card__head">
          <div>
            <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Contato</p>
            <h3>Canais da loja</h3>
          </div>
          <span class="sidebar-card__badge" aria-hidden="true">#</span>
        </div>
        <div class="sidebar-card__stats">
          <span><strong>${escapeHtml(whatsapp)}</strong> WhatsApp</span>
          <span><strong>${escapeHtml(email || "sem email")}</strong> Email</span>
          <span><strong>${escapeHtml(instagram || "sem instagram")}</strong> Instagram</span>
          <span><strong>${escapeHtml(pixKey || "sem chave")}</strong> Pix</span>
          <span><strong>${escapeHtml(pixCode || pixQrCode || boletoCode || "sem código")}</strong> Pagamento</span>
        </div>
      </article>
    `;
  }

  function renderHomeCatalog(currentUser) {
    document.querySelectorAll(".page--home .catalog-rail").forEach((rail) => {
      rail.innerHTML = renderProductCards(getProducts(), "home", currentUser, 4);
    });
  }

  function renderCatalogPage(currentUser) {
    document.querySelectorAll(".page:not(.page--home) .section--catalog .catalog-rail, .page:not(.page--home) .catalog-rail").forEach((rail) => {
      if (rail.closest("[data-client-portal]")) {
        return;
      }

      rail.innerHTML = renderProductCards(getProducts(), "catalog", currentUser);
    });

    document.querySelectorAll("[data-catalog-cart-shell]").forEach((shell) => {
      shell.innerHTML = renderCatalogCartPanel(currentUser);
    });
  }

  function renderCatalogCartPanel(currentUser) {
    if (currentUser) {
      const cartState = cartSummary(currentUser.id);
      const userOrders = getOrders().filter((order) => order.userId === currentUser.id);

      return `
        <article class="operation-card catalog-cart-panel__card">
          ${renderCartPreview(cartState, userOrders)}
        </article>
      `;
    }

    return `
      <article class="operation-card catalog-cart-panel__card catalog-cart-panel__card--empty">
        <div class="operation-card__header">
          <div>
            <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Carrinho</p>
            <h3>Monte sua sacola</h3>
          </div>
          <span class="summary-card__badge" aria-hidden="true">0</span>
        </div>
        <div class="empty-state">
          <h3>Entre para adicionar produtos</h3>
          <p>Faça login para guardar os itens da sua lista de compras e confirmar o pedido depois.</p>
        </div>
        <div class="crud-form__footer">
          <a class="btn btn--solid" href="acesso.html?next=cliente.html">Entrar</a>
          <a class="btn btn--light" href="cliente.html">Minha área</a>
        </div>
      </article>
    `;
  }

  function renderClientPortal(currentUser) {
    const main = document.querySelector("body[data-role='cliente'] .main");
    if (!main || !currentUser) {
      return;
    }

    const cartState = cartSummary(currentUser.id);
    const userOrders = getOrders().filter((order) => order.userId === currentUser.id);
    let portal = main.querySelector("[data-client-portal]");

    if (!portal) {
      const shell = main.querySelector("[data-client-shell]");
      const template = `
        <div class="portal-layout portal-layout--client" data-client-portal>
          <div class="portal-layout__content">
            <section class="section section--summary" data-client-intro id="inicio">
              <div class="section__inner">
                <div class="cta-banner cta-banner--notice">
                  <div>
                    <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Bem-vindo</p>
                    <h2>Monte seu carrinho e acompanhe seus pedidos.</h2>
                    <p>Olá, ${escapeHtml(currentUser.name)}. Navegue pelo catálogo, confirme sua compra e acompanhe em tempo real.</p>
                  </div>
                  <div class="cta-banner__actions">
                    <a class="btn btn--solid" href="#catalogo">
                      ${renderButtonIcon("catalog")}
                      <span>Explorar catálogo</span>
                    </a>
                    <a class="btn btn--light" href="#meus-pedidos">
                      ${renderButtonIcon("orders")}
                      <span>Ver meus pedidos</span>
                    </a>
                  </div>
                </div>
              </div>
            </section>

            <section class="section section--catalog" id="catalogo">
              <div class="section__inner">
                <div class="section__head section__head--stack">
                  <div>
                    <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Catálogo</p>
                    <h2>Produtos disponíveis</h2>
                  </div>
                  <p class="section__lead">Veja todas as peças em estoque, com preços atualizados e carrinho sincronizado em tempo real.</p>
                </div>
                <div class="catalog-rail" data-client-catalog></div>
              </div>
            </section>

            <section class="section section--operations" data-client-cart id="carrinho">
              <div class="section__inner">
                <div class="section__head section__head--stack">
                  <div>
                    <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Carrinho</p>
                    <h2>Carrinho em tempo real</h2>
                  </div>
                  <p class="section__lead">Veja os itens mudando enquanto adiciona produtos e confirme o pedido quando estiver pronto.</p>
                </div>
                <div class="operations-grid client-grid">
                  <article class="operation-card">
                    <div class="operation-card__header">
                      <div>
                        <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Itens</p>
                        <h3>Carrinho atual</h3>
                      </div>
                      <span class="summary-card__badge" aria-hidden="true" data-cart-count>0</span>
                    </div>
                    <div class="table-wrap">
                      <table class="data-table">
                        <thead>
                          <tr>
                            <th>Foto</th>
                            <th>Produto</th>
                            <th>Qtd.</th>
                            <th>Valor</th>
                            <th>Subtotal</th>
                            <th>Ações</th>
                          </tr>
                        </thead>
                        <tbody data-cart-table></tbody>
                      </table>
                    </div>
                    <div class="cart-summary">
                      <strong>Total</strong>
                      <span data-cart-total>R$ 0,00</span>
                    </div>
                  </article>

                  <article class="operation-card" data-cart-preview-shell></article>
                </div>
              </div>
            </section>

            <section class="section section--summary" data-client-orders id="meus-pedidos">
              <div class="section__inner">
                <div class="section__head section__head--stack">
                  <div>
                    <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Meus pedidos</p>
                    <h2>Acompanhe seus pedidos</h2>
                  </div>
                  <p class="section__lead">Quando a compra é confirmada, ela aparece aqui com o status atualizado em tempo real.</p>
                </div>
                <div class="operations-grid client-orders-grid">
                  <article class="operation-card">
                    <div class="operation-card__header">
                      <div>
                        <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Histórico</p>
                        <h3>Seus pedidos</h3>
                      </div>
                    </div>
                    <div class="order-list" data-order-list></div>
                  </article>
                  <div class="sidebar-stack" data-order-status-summary></div>
                </div>
              </div>
            </section>
          </div>
        </div>
      `;
      if (shell) {
        shell.innerHTML = template;
      } else {
        main.innerHTML = template;
      }
      portal = main.querySelector("[data-client-portal]");
    }

    const clientCatalog = portal.querySelector("[data-client-catalog]");
    if (clientCatalog) {
      clientCatalog.innerHTML = renderProductCards(getProducts(), "client", currentUser);
    }

    const clientCart = portal.querySelector("[data-client-cart]");
    if (clientCart) {
      clientCart.querySelector("[data-cart-count]").textContent = String(cartState.lines.length);
      clientCart.querySelector("[data-cart-total]").textContent = formatCurrency(cartState.total);
      clientCart.querySelector("[data-cart-table]").innerHTML = renderCartRows(cartState.lines);
      const previewSlot = clientCart.querySelector("[data-cart-preview-shell]");
      if (previewSlot) {
        previewSlot.innerHTML = renderCartPreview(cartState, userOrders);
      }
    }

    const clientOrders = portal.querySelector("[data-client-orders]");
    if (clientOrders) {
      clientOrders.querySelector("[data-order-list]").innerHTML = renderClientOrdersRows(userOrders.slice(0, 6));
      const orderSummary = clientOrders.querySelector("[data-order-status-summary]");
      if (orderSummary) {
        orderSummary.innerHTML = renderOrderStatusSummary(userOrders);
      }
    }
  }

  function renderCheckoutSellerPaymentCard(settings, profile) {
    const pixKey = String(settings.pixKey || "").trim();
    const pixCode = String(settings.pixCode || "").trim();
    const pixQrCode = String(settings.pixQrCode || "").trim();
    const boletoCode = String(settings.boletoCode || "").trim();
    const paymentNote = String(settings.paymentNote || "").trim();
    const qrContent = String(pixQrCode || "").trim();
    const pixCopyValue = pixCode || pixKey || qrContent;

    const qrMarkup = qrContent
      ? /^https?:\/\//i.test(qrContent) || /^data:image\//i.test(qrContent)
        ? `<img class="checkout-payment__qr-image" src="${escapeAttr(qrContent)}" alt="QR code do Pix" />`
        : `<code class="checkout-payment__code">${escapeHtml(qrContent)}</code>`
      : `<p class="checkout-payment__empty">Nenhum QR code Pix foi cadastrado.</p>`;

    return `
      <article class="operation-card checkout-payment-card">
        <div class="operation-card__header">
          <div>
            <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Pagamento da loja</p>
            <h3>Dados da vendedora</h3>
          </div>
          <span class="summary-card__badge" aria-hidden="true">Métodos</span>
        </div>
        <div class="checkout-payment__grid">
          <div class="checkout-payment__block checkout-payment__block--pix">
            <strong>Pix</strong>
            ${pixKey ? `<p><span>Chave:</span> <strong>${escapeHtml(pixKey)}</strong></p>` : `<p class="checkout-payment__empty">Pix ainda não foi configurado.</p>`}
            ${pixCode
              ? `
                <div class="checkout-payment__code-wrap checkout-payment__code-wrap--highlight">
                  <span>Código copia e cola</span>
                  <code class="checkout-payment__code">${escapeHtml(pixCode)}</code>
                  ${pixCopyValue ? `
                    <div class="checkout-payment__copy-row">
                      <button type="button" class="btn btn--light checkout-payment__copy-btn" data-copy-pix data-copy-pix-value="${escapeAttr(pixCopyValue)}" data-original-label="Copiar Pix">Copiar Pix</button>
                      <span class="checkout-payment__copy-feedback" data-copy-pix-feedback aria-live="polite"></span>
                    </div>
                  ` : ""}
                </div>
              `
              : pixCopyValue
                ? `
                  <div class="checkout-payment__copy-row checkout-payment__copy-row--standalone">
                    <button type="button" class="btn btn--light checkout-payment__copy-btn" data-copy-pix data-copy-pix-value="${escapeAttr(pixCopyValue)}" data-original-label="Copiar Pix">Copiar Pix</button>
                    <span class="checkout-payment__copy-feedback" data-copy-pix-feedback aria-live="polite"></span>
                  </div>
                `
                : ""
            }
            <div class="checkout-payment__qr-shell${qrContent ? " checkout-payment__qr-shell--active" : ""}">
              <span>QR code Pix</span>
              ${qrMarkup}
            </div>
          </div>
          <div class="checkout-payment__block">
            <strong>Cartão</strong>
            <p>${escapeHtml(paymentNote || "Os dados do cartão são usados apenas nesta etapa e não ficam armazenados por completo.")}</p>
            <p class="checkout-payment__hint">A cliente pode escolher débito ou crédito no formulário.</p>
          </div>
          <div class="checkout-payment__block">
            <strong>Boleto</strong>
            ${boletoCode ? `<div class="checkout-payment__code-wrap"><span>Linha digitável ou link</span><code class="checkout-payment__code">${escapeHtml(boletoCode)}</code></div>` : `<p class="checkout-payment__empty">Boleto ainda não foi configurado.</p>`}
          </div>
        </div>
      </article>
    `;
  }

  function renderCheckoutPage(currentUser) {
    if (currentPageName() !== "checkout.html") {
      return;
    }

    const main = document.querySelector(".main");
    if (!main || !currentUser) {
      return;
    }

    const draft = ensureCheckoutDraft(currentUser.id);
    const settings = getSettings();
    let portal = main.querySelector("[data-checkout-page]");
    const profile = draft ? (getCheckoutProfile(draft.id) || buildCheckoutProfileDefaults(currentUser, draft, settings)) : null;

    const renderItem = (item) => `
      <article class="checkout-item">
        <div class="checkout-item__media">
          ${renderRecordMedia(item, "thumb")}
        </div>
        <div class="checkout-item__body">
          <div class="checkout-item__head">
            <div>
              <strong>${escapeHtml(item.name)}</strong>
              <span class="table-sub">${escapeHtml(item.quantity)} unidade${Number(item.quantity) === 1 ? "" : "s"} • ${escapeHtml(item.stock)} em estoque</span>
            </div>
            <strong>${formatCurrency(item.subtotal)}</strong>
          </div>
          <p class="checkout-item__hint">Subtotal da sacola para esta peça.</p>
        </div>
      </article>
    `;

    const template = `
      <div class="checkout-layout" data-checkout-page>
        <section class="section section--summary" id="checkout">
          <div class="section__inner">
            <div class="section__head section__head--stack">
              <div>
                <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Checkout</p>
                <h2>Confirme o pagamento do pedido</h2>
              </div>
              <p class="section__lead">Revise a sacola, preencha os dados do checkout e só então confirme o pagamento para o pedido seguir para a vendedora.</p>
            </div>
            ${
              draft
                ? `
                  <div class="checkout-grid">
                    <article class="operation-card checkout-summary-card">
                      <div class="operation-card__header">
                        <div>
                          <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Sacola</p>
                          <h3>Itens que vão para o pagamento</h3>
                        </div>
                        <span class="summary-card__badge" aria-hidden="true">${escapeHtml(draft.items.length)}</span>
                      </div>
                      <div class="checkout-summary__stats">
                        <span><strong>${escapeHtml(draft.items.length)}</strong> itens distintos</span>
                        <span><strong>${escapeHtml(draft.quantity)}</strong> unidades</span>
                        <span><strong>${formatCurrency(draft.total)}</strong> total</span>
                      </div>
                      <div class="checkout-summary__list">
                        ${draft.items.map((item) => renderItem(item)).join("")}
                      </div>
                      <ul class="payment-list checkout-steps" aria-label="Etapas do checkout">
                        <li>
                          <span class="payment-list__icon">1</span>
                          <div>
                            <strong>Revise a sacola</strong>
                            <p>Confira cada produto, quantidade e valor antes de confirmar o pagamento.</p>
                          </div>
                        </li>
                        <li>
                          <span class="payment-list__icon">2</span>
                          <div>
                            <strong>Preencha os dados</strong>
                            <p>Informe CPF/CNPJ, telefone, email, endereço e a forma de pagamento escolhida.</p>
                          </div>
                        </li>
                        <li>
                          <span class="payment-list__icon">3</span>
                          <div>
                            <strong>Pedido pago</strong>
                            <p>Depois da confirmação, o pedido entra no painel da vendedora com status Pago.</p>
                          </div>
                        </li>
                      </ul>
                    </article>

                    <article class="operation-card checkout-form-card">
                        <div class="operation-card__header">
                          <div>
                            <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Pagamento</p>
                            <h3>Dados do cliente e pagamento</h3>
                          </div>
                          <span class="summary-card__badge" aria-hidden="true">Rascunho</span>
                        </div>
                      <form class="crud-form checkout-form" data-checkout-form>
                        <input type="hidden" name="checkoutId" value="${escapeAttr(draft.id)}" />

                        <div class="checkout-form__section">
                          <div class="checkout-form__section-head">
                            <h4>Dados pessoais</h4>
                            <p>Os dados abaixo ficam associados ao checkout e ao pedido pago.</p>
                          </div>
                          <div class="field-grid field-grid--wide">
                            <label class="field">
                              <span>Nome da cliente</span>
                              <input type="text" name="customerName" value="${escapeAttr(profile?.customerName || currentUser.name || "")}" autocomplete="name" required />
                            </label>
                            <label class="field">
                              <span>CPF/CNPJ</span>
                              <select name="documentType" required>
                                <option value="cpf"${String(profile?.documentType || "cpf") === "cpf" ? " selected" : ""}>CPF</option>
                                <option value="cnpj"${String(profile?.documentType || "cpf") === "cnpj" ? " selected" : ""}>CNPJ</option>
                              </select>
                            </label>
                            <label class="field">
                              <span>Número do documento</span>
                              <input type="text" name="documentNumber" value="${escapeAttr(profile?.documentNumber || "")}" placeholder="Somente números" inputmode="numeric" required />
                            </label>
                            <label class="field">
                              <span>Telefone</span>
                              <input type="text" name="phone" value="${escapeAttr(profile?.phone || "")}" placeholder="(11) 99999-9999" autocomplete="tel" required />
                            </label>
                            <label class="field">
                              <span>Email</span>
                              <input type="email" name="email" value="${escapeAttr(profile?.email || currentUser.email || "")}" placeholder="voce@exemplo.com" autocomplete="email" required />
                            </label>
                            <label class="field">
                              <span>CEP</span>
                              <input type="text" name="zipCode" value="${escapeAttr(profile?.zipCode || "")}" placeholder="00000-000" inputmode="numeric" required />
                            </label>
                            <label class="field field--wide">
                              <span>Rua</span>
                              <input type="text" name="street" value="${escapeAttr(profile?.street || "")}" placeholder="Nome da rua e avenida" required />
                            </label>
                            <label class="field">
                              <span>Número</span>
                              <input type="text" name="number" value="${escapeAttr(profile?.number || "")}" placeholder="123" required />
                            </label>
                            <label class="field">
                              <span>Complemento</span>
                              <input type="text" name="complement" value="${escapeAttr(profile?.complement || "")}" placeholder="Apto, bloco, casa" />
                            </label>
                            <label class="field">
                              <span>Bairro</span>
                              <input type="text" name="neighborhood" value="${escapeAttr(profile?.neighborhood || "")}" placeholder="Centro, Jardim..." required />
                            </label>
                            <label class="field">
                              <span>Cidade</span>
                              <input type="text" name="city" value="${escapeAttr(profile?.city || "")}" placeholder="Cidade" required />
                            </label>
                            <label class="field">
                              <span>Estado</span>
                              <input type="text" name="state" value="${escapeAttr(profile?.state || "")}" placeholder="UF" maxlength="2" required />
                            </label>
                          </div>
                        </div>

                        <div class="checkout-form__section">
                          <div class="checkout-form__section-head">
                            <h4>Forma de pagamento</h4>
                            <p>Escolha como a cliente vai pagar e se haverá parcelamento.</p>
                          </div>
                          <div class="field-grid field-grid--wide">
                            <label class="field">
                              <span>Pagamento</span>
                              <select name="paymentMethod" required>
                                <option value="pix"${String(profile?.paymentMethod || "pix") === "pix" ? " selected" : ""}>Pix</option>
                                <option value="card"${String(profile?.paymentMethod || "") === "card" ? " selected" : ""}>Cartão</option>
                                <option value="boleto"${String(profile?.paymentMethod || "") === "boleto" ? " selected" : ""}>Boleto</option>
                              </select>
                            </label>
                            <label class="field">
                              <span>Tipo do cartão</span>
                              <select name="cardType">
                                <option value="credit"${String(profile?.cardType || "credit") === "credit" ? " selected" : ""}>Crédito</option>
                                <option value="debit"${String(profile?.cardType || "") === "debit" ? " selected" : ""}>Débito</option>
                              </select>
                            </label>
                            <label class="field">
                              <span>Condição</span>
                              <select name="paymentPlan">
                                <option value="avista"${String(profile?.paymentPlan || "avista") === "avista" ? " selected" : ""}>À vista</option>
                                <option value="parcelado"${String(profile?.paymentPlan || "") === "parcelado" ? " selected" : ""}>Parcelado</option>
                              </select>
                            </label>
                            <label class="field" data-checkout-installments-panel>
                              <span>Parcelas</span>
                              <input type="number" name="installments" min="2" max="12" step="1" value="${escapeAttr(String(profile?.installments || 1))}" />
                            </label>
                          </div>
                        </div>

                        <div class="checkout-form__section" data-checkout-card-panel>
                          <div class="checkout-form__section-head">
                            <h4>Dados do cartão</h4>
                            <p>Usados apenas quando a forma escolhida for cartão.</p>
                          </div>
                          <div class="field-grid field-grid--wide">
                            <label class="field">
                              <span>Nome no cartão</span>
                              <input type="text" name="cardHolder" value="${escapeAttr(profile?.cardHolder || currentUser.name || "")}" autocomplete="cc-name" />
                            </label>
                            <label class="field">
                              <span>Bandeira</span>
                              <select name="cardBrand">
                                <option value="">Selecione</option>
                                <option value="visa"${String(profile?.cardBrand || "") === "visa" ? " selected" : ""}>Visa</option>
                                <option value="mastercard"${String(profile?.cardBrand || "") === "mastercard" ? " selected" : ""}>Mastercard</option>
                                <option value="elo"${String(profile?.cardBrand || "") === "elo" ? " selected" : ""}>Elo</option>
                                <option value="amex"${String(profile?.cardBrand || "") === "amex" ? " selected" : ""}>Amex</option>
                                <option value="hipercard"${String(profile?.cardBrand || "") === "hipercard" ? " selected" : ""}>Hipercard</option>
                                <option value="outros"${String(profile?.cardBrand || "") === "outros" ? " selected" : ""}>Outros</option>
                              </select>
                            </label>
                            <label class="field">
                              <span>Número do cartão</span>
                              <input type="text" name="cardNumber" autocomplete="cc-number" placeholder="Apenas para esta confirmação" inputmode="numeric" />
                            </label>
                            <label class="field">
                              <span>Validade</span>
                              <input type="text" name="cardExpiry" autocomplete="cc-exp" placeholder="MM/AA" />
                            </label>
                            <label class="field">
                              <span>CVV</span>
                              <input type="password" name="cardCvv" autocomplete="cc-csc" placeholder="123" />
                            </label>
                            <label class="field field--wide">
                              <span>Observações do pedido</span>
                              <textarea name="note" rows="3" placeholder="Referências, horário ou instruções adicionais">${escapeHtml(profile?.note || "")}</textarea>
                            </label>
                          </div>
                          <p class="checkout-form__security-note">O número completo do cartão e o CVV não são salvos no banco. Apenas os últimos 4 dígitos e o resumo do pagamento ficam associados ao pedido.</p>
                        </div>

                        ${renderCheckoutSellerPaymentCard(settings, profile)}

                        <div class="checkout-form__notice">
                          <strong>O pedido só vira pedido pago depois da confirmação.</strong>
                          <p>Ao confirmar, o sistema salva os dados iniciais do checkout, grava o pedido como Pago e atualiza o histórico da cliente e da vendedora.</p>
                        </div>
                        <div class="crud-form__footer">
                          <a class="btn btn--light" href="cliente.html#carrinho">Voltar ao carrinho</a>
                          <a class="btn btn--light" href="catalogo.html">Editar no catálogo</a>
                          <button class="btn btn--solid" type="submit">Confirmar pagamento</button>
                        </div>
                      </form>
                    </article>
                  </div>
                `
                : `
                  <div class="empty-state checkout-empty">
                    <h3>Sacola vazia</h3>
                    <p>Adicione produtos ao carrinho para seguir para a tela de pagamento.</p>
                    <div class="crud-form__footer">
                      <a class="btn btn--solid" href="catalogo.html">Ir ao catálogo</a>
                      <a class="btn btn--light" href="cliente.html#carrinho">Abrir carrinho</a>
                    </div>
                  </div>
                `
            }
          </div>
        </section>
      </div>
    `;

    if (!portal) {
      const shell = main.querySelector("[data-checkout-shell]");
      if (shell) {
        shell.innerHTML = template;
      } else {
        main.innerHTML = template;
      }
      portal = main.querySelector("[data-checkout-page]");
    } else {
      portal.outerHTML = template;
      portal = main.querySelector("[data-checkout-page]");
    }

    const form = portal ? portal.querySelector("[data-checkout-form]") : null;
    if (form) {
      updateCheckoutPaymentSections(form);
    }
  }

  function renderSellerPortal(currentUser) {
    const main = document.querySelector("body[data-role='vendedora'] .main");
    if (!main || !currentUser || !isAdmin(currentUser)) {
      return;
    }

    const users = getUsers();
    const products = getProducts();
    const suppliers = getSuppliers();
    const employees = getEmployees();
    const orders = getOrders();
    const settings = getSettings();
    let portal = main.querySelector("[data-seller-portal]");

    if (!portal) {
      const shell = main.querySelector("[data-seller-shell]");
      const template = `
        <div class="portal-layout portal-layout--seller" data-seller-portal>
          <aside class="portal-sidebar"></aside>
          <button type="button" class="portal-layout__backdrop" data-sidebar-backdrop aria-label="Fechar menu lateral"></button>
          <div class="portal-layout__content">
            <section class="section section--summary" data-seller-intro id="painel">
              <div class="section__inner">
                <div class="cta-banner cta-banner--notice">
                  <div>
                    <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Área da vendedora</p>
                    <h2>Pedidos, estoque e cadastros em um único painel.</h2>
                    <p>Olá, ${escapeHtml(currentUser.name)}. Aqui você atende os pedidos recebidos, acompanha o estoque e mantém o CRUD organizado sem sair do painel.</p>
                  </div>
                  <div class="cta-banner__actions">
                    <button type="button" class="btn btn--solid" data-scroll-target="pedidos">Ver pedidos</button>
                    <button type="button" class="btn btn--light" data-scroll-target="users">Abrir cadastros</button>
                  </div>
                </div>
              </div>
            </section>

            <section class="section section--summary" data-seller-dashboard id="estoque">
              <div class="section__inner">
                <div class="section__head section__head--stack">
                  <div>
                    <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Estoque</p>
                    <h2>Painel interno</h2>
                  </div>
                  <p class="section__lead">KPIs, gráficos e alertas que alimentam a operação da loja em tempo real.</p>
                </div>
                <div class="dashboard-notice" data-admin-notice></div>
                <div class="summary-grid" data-kpi-grid></div>
                <div class="operations-grid dashboard-charts">
                  <article class="operation-card chart-card">
                    <div class="operation-card__header">
                      <div>
                        <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Gráfico</p>
                        <h3>Produtos por categoria</h3>
                      </div>
                    </div>
                    <div class="chart-bars" data-category-chart></div>
                  </article>
                  <article class="operation-card chart-card">
                    <div class="operation-card__header">
                      <div>
                        <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Gráfico</p>
                        <h3>Pedidos por status</h3>
                      </div>
                    </div>
                    <div class="chart-bars" data-order-chart></div>
                  </article>
                </div>
              </div>
            </section>

            <section class="section section--operations" data-seller-orders id="pedidos">
              <div class="section__inner">
                <div class="section__head section__head--stack">
                  <div>
                    <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Pedidos</p>
                    <h2>Fila de atendimento</h2>
                  </div>
                  <p class="section__lead">Os pedidos confirmados pela cliente entram aqui e o status volta para a aba de pedidos dela.</p>
                </div>
                <div class="operations-grid seller-orders-grid">
                  <article class="operation-card" data-seller-order-list-shell></article>
                  <div class="sidebar-stack" data-seller-order-summary></div>
                </div>
              </div>
            </section>

            <section class="section section--operations" data-seller-management id="cadastros">
              <div class="section__inner">
                <div class="section__head section__head--stack">
                  <div>
                    <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>CRUD</p>
                    <h2>Cadastro e gerenciamento</h2>
                  </div>
                  <p class="section__lead">Usuários, produtos, fornecedores, funcionários e contato ficam organizados sem deixar uma coluna vazia.</p>
                </div>
                <div class="management-layout">
                  <div class="management-main">
                    <div class="crud-tabs" role="tablist" aria-label="Cadastros internos">
                      <button class="crud-tab is-active" type="button" role="tab" aria-selected="true" data-crud-tab="users">Usuários</button>
                      <button class="crud-tab" type="button" role="tab" aria-selected="false" data-crud-tab="products">Produtos</button>
                      <button class="crud-tab" type="button" role="tab" aria-selected="false" data-crud-tab="suppliers">Fornecedores</button>
                      <button class="crud-tab" type="button" role="tab" aria-selected="false" data-crud-tab="employees">Funcionários</button>
                      <button class="crud-tab" type="button" role="tab" aria-selected="false" data-crud-tab="contact">Contato</button>
                    </div>
                    <div class="crud-stage">
                      <article class="operation-card crud-panel" data-crud-panel="users">
                        <div class="operation-card__header">
                          <div>
                            <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Usuários</p>
                            <h3>Gerenciar acessos</h3>
                          </div>
                          <button type="button" class="table-action" data-reset-form="users">Limpar</button>
                        </div>
                        <form class="crud-form" data-crud-form="users">
                          <input type="hidden" name="id" />
                          <div class="field-grid">
                            <label class="field"><span>Nome</span><input type="text" name="name" required /></label>
                            <label class="field"><span>Email</span><input type="email" name="email" placeholder="nome@dominio.com" /></label>
                            <label class="field"><span>Usuário</span><input type="text" name="username" required /></label>
                            <div class="field field--password">
                              <label for="crud-user-password"><span>Senha</span></label>
                              <div class="field__password">
                                <input type="password" id="crud-user-password" name="password" required />
                                <button class="password-toggle" type="button" data-toggle-password aria-pressed="false" aria-label="Mostrar senha" title="Mostrar senha">
                                  <svg class="password-toggle__icon password-toggle__icon--show" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                                    <circle cx="12" cy="12" r="3" />
                                  </svg>
                                  <svg class="password-toggle__icon password-toggle__icon--hide" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M3 3l18 18" />
                                    <path d="M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-1.2" />
                                    <path d="M5.6 5.6C3.5 7.5 2 12 2 12s3.5 7 10 7a10.4 10.4 0 0 0 3.4-.6" />
                                    <path d="M18.4 18.4C20.5 16.5 22 12 22 12s-3.5-7-10-7a10.4 10.4 0 0 0-3.4.6" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                            <label class="field field--wide"><span>Foto</span><input type="file" name="imageFile" accept="image/*" /></label>
                            <label class="field"><span>Permissão</span><select name="role"><option value="cliente">Cliente</option><option value="admin">Administrador</option></select></label>
                          </div>
                          <div class="crud-form__footer">
                            <button class="btn btn--solid" type="submit">Salvar usuário</button>
                          </div>
                        </form>
                        <div class="table-wrap">
                          <table class="data-table">
                            <thead>
                              <tr>
                                <th>Foto</th>
                                <th>Nome</th>
                                <th>Email</th>
                                <th>Login</th>
                                <th>Perfil</th>
                                <th>Ações</th>
                              </tr>
                            </thead>
                            <tbody data-table-body="users"></tbody>
                          </table>
                        </div>
                      </article>

                      <article class="operation-card crud-panel" data-crud-panel="products">
                        <div class="operation-card__header">
                          <div>
                            <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Produtos</p>
                            <h3>Cadastro de roupas</h3>
                          </div>
                          <button type="button" class="table-action" data-reset-form="products">Limpar</button>
                        </div>
                        <div class="product-save-notice" data-product-save-notice hidden aria-live="polite"></div>
                        <div class="product-editor">
                          <form class="crud-form product-editor__form" data-crud-form="products">
                            <input type="hidden" name="id" />
                            <div class="field-grid field-grid--wide">
                              <label class="field"><span>Nome</span><input type="text" name="name" required /></label>
                              <label class="field"><span>Preço</span><input type="text" name="price" placeholder="99,90" required /></label>
                              <label class="field"><span>Quantidade</span><input type="number" name="quantity" min="0" step="1" required /></label>
                              <label class="field"><span>Tamanhos</span><input type="text" name="sizes" placeholder="P, M, G" /></label>
                              <label class="field"><span>Categorias</span><input type="text" name="categories" placeholder="Festa, Casual" /></label>
                              <label class="field field--wide"><span>Fotos</span><input type="file" name="imageFiles" accept="image/*" multiple /></label>
                              <div class="field field--wide product-media-field">
                                <span>Foto principal</span>
                                <input type="hidden" name="primaryImage" />
                                <div class="product-media-field__preview" data-product-media-preview></div>
                              </div>
                              <label class="field"><span>Modo da foto</span><select name="imageFit"><option value="cover">Corte cheio</option><option value="contain" selected>Mostrar inteira</option><option value="fill">Preencher</option><option value="scale-down">Reduzir</option></select></label>
                              <label class="field"><span>Foco horizontal</span><input type="range" name="imagePositionX" min="0" max="100" step="1" value="50" /></label>
                              <label class="field"><span>Foco vertical</span><input type="range" name="imagePositionY" min="0" max="100" step="1" value="50" /></label>
                              <label class="field field--wide"><span>Descrição</span><textarea name="description" rows="3" required></textarea></label>
                              <label class="field field--inline"><input type="checkbox" name="featured" checked /><span>Destaque</span></label>
                              <label class="field field--inline"><input type="checkbox" name="active" checked /><span>Ativo</span></label>
                            </div>
                            <div class="crud-form__footer">
                              <button class="btn btn--solid" type="submit">Salvar produto</button>
                            </div>
                          </form>
                          <aside class="product-preview product-editor__preview" data-product-preview>
                            <div class="product-preview__head">
                              <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Prévia</p>
                              <h4>Como a peça vai aparecer</h4>
                            </div>
                            <div class="product-preview__card" data-product-preview-card></div>
                          </aside>
                        </div>
                        <div class="table-wrap">
                          <table class="data-table">
                            <thead>
                              <tr>
                                <th>Produto</th>
                                <th>Categorias</th>
                                <th>Preço</th>
                                <th>Qtd.</th>
                                <th>Tamanhos</th>
                                <th>Status</th>
                                <th>Ações</th>
                              </tr>
                            </thead>
                            <tbody data-table-body="products"></tbody>
                          </table>
                        </div>
                      </article>

                      <article class="operation-card crud-panel" data-crud-panel="suppliers">
                        <div class="operation-card__header">
                          <div>
                            <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Fornecedores</p>
                            <h3>Rede de reposição</h3>
                          </div>
                          <button type="button" class="table-action" data-reset-form="suppliers">Limpar</button>
                        </div>
                        <form class="crud-form" data-crud-form="suppliers">
                          <input type="hidden" name="id" />
                          <div class="field-grid">
                            <label class="field"><span>Nome</span><input type="text" name="name" required /></label>
                            <label class="field"><span>Contato</span><input type="text" name="contact" /></label>
                            <label class="field"><span>Categoria</span><input type="text" name="category" /></label>
                            <label class="field field--wide"><span>Foto</span><input type="file" name="imageFile" accept="image/*" /></label>
                            <label class="field field--wide"><span>Observação</span><textarea name="note" rows="3"></textarea></label>
                          </div>
                          <div class="crud-form__footer">
                            <button class="btn btn--solid" type="submit">Salvar fornecedor</button>
                          </div>
                        </form>
                        <div class="table-wrap">
                          <table class="data-table">
                            <thead>
                              <tr>
                                <th>Foto</th>
                                <th>Fornecedor</th>
                                <th>Contato</th>
                                <th>Categoria</th>
                                <th>Observação</th>
                                <th>Ações</th>
                              </tr>
                            </thead>
                            <tbody data-table-body="suppliers"></tbody>
                          </table>
                        </div>
                      </article>

                      <article class="operation-card crud-panel" data-crud-panel="employees">
                        <div class="operation-card__header">
                          <div>
                            <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Funcionários</p>
                            <h3>Equipe da loja</h3>
                          </div>
                          <button type="button" class="table-action" data-reset-form="employees">Limpar</button>
                        </div>
                        <form class="crud-form" data-crud-form="employees">
                          <input type="hidden" name="id" />
                          <div class="field-grid">
                            <label class="field"><span>Nome</span><input type="text" name="name" required /></label>
                            <label class="field"><span>Função</span><input type="text" name="role" /></label>
                            <label class="field"><span>Contato</span><input type="text" name="contact" /></label>
                            <label class="field"><span>Turno</span><input type="text" name="shift" /></label>
                            <label class="field field--wide"><span>Foto</span><input type="file" name="imageFile" accept="image/*" /></label>
                          </div>
                          <div class="crud-form__footer">
                            <button class="btn btn--solid" type="submit">Salvar funcionário</button>
                          </div>
                        </form>
                        <div class="table-wrap">
                          <table class="data-table">
                            <thead>
                              <tr>
                                <th>Foto</th>
                                <th>Funcionário</th>
                                <th>Função</th>
                                <th>Contato</th>
                                <th>Turno</th>
                                <th>Ações</th>
                              </tr>
                            </thead>
                            <tbody data-table-body="employees"></tbody>
                          </table>
                        </div>
                      </article>

                      <article class="operation-card crud-panel" data-crud-panel="contact">
                        <div class="operation-card__header">
                          <div>
                            <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Contato</p>
                            <h3>WhatsApp e canais</h3>
                          </div>
                          <button type="button" class="table-action" data-reset-form="contact">Limpar</button>
                        </div>
                        <form class="crud-form" data-settings-form="contact">
                          <div class="field-grid field-grid--wide">
                            <label class="field"><span>WhatsApp</span><input type="text" name="whatsapp" placeholder="${STORE_WHATSAPP_DIGITS}" /></label>
                            <label class="field"><span>Telefone</span><input type="text" name="phone" placeholder="(11) 99999-9999" /></label>
                            <label class="field"><span>Email</span><input type="email" name="email" placeholder="contato@vzstore.com.br" /></label>
                            <label class="field"><span>Endereco</span><input type="text" name="address" placeholder="Rua, bairro, cidade" /></label>
                            <label class="field"><span>Instagram</span><input type="text" name="instagram" placeholder="@vzstore" /></label>
                            <label class="field field--wide"><span>Observacao</span><textarea name="note" rows="3" placeholder="Horario, recados e orientacoes"></textarea></label>
                            <label class="field"><span>Chave Pix</span><input type="text" name="pixKey" placeholder="CPF, email, telefone ou chave aleatoria" /></label>
                            <label class="field"><span>Código Pix</span><textarea name="pixCode" rows="3" placeholder="Copia e cola do Pix"></textarea></label>
                            <label class="field"><span>QR Code Pix</span><input type="url" name="pixQrCode" placeholder="https://..." /></label>
                            <label class="field"><span>Código do boleto</span><textarea name="boletoCode" rows="3" placeholder="Linha digitavel ou link do boleto"></textarea></label>
                            <label class="field field--wide"><span>Observacao de pagamento</span><textarea name="paymentNote" rows="3" placeholder="Orientacoes para Pix, cartao e boleto"></textarea></label>
                          </div>
                          <div class="crud-form__footer">
                            <button class="btn btn--solid" type="submit">Salvar contato</button>
                          </div>
                        </form>
                        <div class="contact-preview">
                          <p class="contact-preview__label">Link ativo</p>
                          <a class="contact-preview__link" href="#contato" data-whatsapp-link data-whatsapp-fallback="#contato">Abrir WhatsApp</a>
                          <p class="contact-preview__note">O numero salvo aqui alimenta os botoes de contato da loja.</p>
                        </div>
                      </article>
                    </div>
                  </div>
                  <aside class="management-rail" data-management-rail></aside>
                </div>
              </div>
            </section>

            <section class="section section--cta" data-seller-contact id="contato">
              <div class="section__inner">
                <div class="cta-banner">
                  <div>
                    <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Contato da loja</p>
                    <h2>Canais e ajustes rápidos</h2>
                    <p>Veja abaixo os dados da loja e salte diretamente para a aba de contato quando precisar atualizar WhatsApp ou endereço.</p>
                    <div class="sidebar-card__stats" data-seller-contact-summary></div>
                  </div>
                  <div class="cta-banner__actions">
                    <button type="button" class="btn btn--solid" data-scroll-target="contact">Abrir contato</button>
                    <a class="btn btn--light" href="#cadastros">Ir para cadastros</a>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      `;
      if (shell) {
        shell.innerHTML = template;
      } else {
        main.innerHTML = template;
      }
      portal = main.querySelector("[data-seller-portal]");
    }

    const sidebar = portal.querySelector(".portal-sidebar");
    if (sidebar) {
      sidebar.outerHTML = renderSellerSidebar(currentUser, orders, products);
    }

    const adminNotice = portal.querySelector("[data-admin-notice]");
    if (adminNotice) {
      adminNotice.innerHTML = currentUser.mustChangePassword
        ? `
          <div class="cta-banner cta-banner--notice">
            <div>
              <p class="section__eyebrow"><span class="section__dot" aria-hidden="true"></span>Conta principal</p>
              <h2>Atualize seus dados de acesso</h2>
              <p>Assim que puder, ajuste nome, usuário e senha para deixar a conta pronta.</p>
            </div>
            <div class="cta-banner__actions">
              <button type="button" class="btn btn--solid" data-scroll-target="users">Ir para usuários</button>
            </div>
          </div>
        `
        : "";
    }

    const metrics = dashboardMetrics(users, products, orders);
    const kpiGrid = portal.querySelector("[data-kpi-grid]");
    if (kpiGrid) {
      kpiGrid.innerHTML = metrics
        .map(
          (item) => `
            <article class="summary-card summary-card--tall">
              <div class="summary-card__top">
                <span class="summary-card__chip">${escapeHtml(item.label)}</span>
                <span class="summary-card__badge" aria-hidden="true">•</span>
              </div>
              <h3>${escapeHtml(item.value)}</h3>
              <p>${escapeHtml(item.helper)}</p>
            </article>
          `,
        )
        .join("");
    }

    const categoryChart = portal.querySelector("[data-category-chart]");
    if (categoryChart) {
      categoryChart.innerHTML = chartBars(categoryChartData(products));
    }

    const orderChart = portal.querySelector("[data-order-chart]");
    if (orderChart) {
      orderChart.innerHTML = chartBars(orderChartData(orders));
    }

    const orderList = portal.querySelector("[data-seller-order-list-shell]");
    if (orderList) {
      orderList.innerHTML = renderSellerOrdersRows(orders);
    }

    const orderSummary = portal.querySelector("[data-seller-order-summary]");
    if (orderSummary) {
      orderSummary.innerHTML = renderOrderStatusSummary(orders);
    }

    const management = portal.querySelector("[data-seller-management]");
    if (management) {
      management.querySelector("[data-table-body='users']").innerHTML = renderUserRows(users);
      management.querySelector("[data-table-body='products']").innerHTML = renderProductRows(products);
      management.querySelector("[data-table-body='suppliers']").innerHTML = renderSupplierRows(suppliers);
      management.querySelector("[data-table-body='employees']").innerHTML = renderEmployeeRows(employees);

      const settingsForm = management.querySelector("[data-settings-form='contact']");
      if (settingsForm) {
        settingsForm.querySelector('[name="whatsapp"]').value = settings.whatsapp || STORE_WHATSAPP_DISPLAY;
        settingsForm.querySelector('[name="phone"]').value = settings.phone || "";
        settingsForm.querySelector('[name="email"]').value = settings.email || "";
        settingsForm.querySelector('[name="address"]').value = settings.address || "";
        settingsForm.querySelector('[name="instagram"]').value = settings.instagram || "";
        settingsForm.querySelector('[name="note"]').value = settings.note || "";
        settingsForm.querySelector('[name="pixKey"]').value = settings.pixKey || "";
        settingsForm.querySelector('[name="pixCode"]').value = settings.pixCode || "";
        settingsForm.querySelector('[name="pixQrCode"]').value = settings.pixQrCode || "";
        settingsForm.querySelector('[name="boletoCode"]').value = settings.boletoCode || "";
        settingsForm.querySelector('[name="paymentNote"]').value = settings.paymentNote || "";
      }

      const activeCrudTab = management.dataset.activeCrudTab || "users";
      setSellerCrudTab(activeCrudTab);

      const productForm = management.querySelector("[data-crud-form='products']");
      if (productForm) {
        void updateProductPreview(productForm);
      }

      const productNotice = management.querySelector("[data-product-save-notice]");
      if (productNotice) {
        productNotice.hidden = !productSaveNotice;
        productNotice.className = `product-save-notice${productSaveNotice ? ` is-${productSaveNoticeTone}` : ""}`;
        productNotice.textContent = productSaveNotice;
      }

      const managementRail = management.querySelector("[data-management-rail]");
      if (managementRail) {
        managementRail.innerHTML = renderSellerManagementRail(
          users,
          products,
          suppliers,
          employees,
          activeCrudTab,
        );
      }
    }

    const contactSummary = portal.querySelector("[data-seller-contact-summary]");
    if (contactSummary) {
      contactSummary.innerHTML = `
        <span><strong>${escapeHtml(formatWhatsAppDisplay(settings.whatsapp || settings.phone || STORE_WHATSAPP_DISPLAY))}</strong> WhatsApp</span>
        <span><strong>${escapeHtml(settings.email || "sem email")}</strong> Email</span>
        <span><strong>${escapeHtml(settings.instagram || "sem instagram")}</strong> Instagram</span>
      `;
    }
  }

  function setSellerCrudTab(tabName) {
    const main = document.querySelector("body[data-role='vendedora'] .main");
    if (!main) {
      return;
    }

    const management = main.querySelector("[data-seller-management]");
    if (!management) {
      return;
    }

    const allowedTabs = new Set(["users", "products", "suppliers", "employees", "contact"]);
    const activeTab = allowedTabs.has(tabName) ? tabName : management.dataset.activeCrudTab || "users";
    management.dataset.activeCrudTab = activeTab;

    management.querySelectorAll("[data-crud-tab]").forEach((button) => {
      const isActive = button.getAttribute("data-crud-tab") === activeTab;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", isActive ? "true" : "false");
      button.tabIndex = isActive ? 0 : -1;
    });

    management.querySelectorAll("[data-crud-panel]").forEach((panel) => {
      const isActive = panel.getAttribute("data-crud-panel") === activeTab;
      panel.toggleAttribute("hidden", !isActive);
    });

    const rail = management.querySelector("[data-management-rail]");
    if (rail) {
      rail.innerHTML = renderSellerManagementRail(
        getUsers(),
        getProducts(),
        getSuppliers(),
        getEmployees(),
        activeTab,
      );
    }
  }

  function fillForm(form, item) {
    if (!form || !item) {
      return;
    }

    form.querySelectorAll("[name]").forEach((field) => {
      if (field.type === "checkbox") {
        field.checked = Boolean(item[field.name]);
        return;
      }

      if (field.type === "file") {
        field.value = "";
        return;
      }

      if (field.name === "sizes" || field.name === "categories") {
        field.value = Array.isArray(item[field.name]) ? item[field.name].join(", ") : String(item[field.name] || "");
        return;
      }

      if (field.name === "imageFit") {
        field.value = item.imageFit || "contain";
        return;
      }

      if (field.name === "imagePositionX") {
        field.value = item.imagePositionX ?? 50;
        return;
      }

      if (field.name === "imagePositionY") {
        field.value = item.imagePositionY ?? 50;
        return;
      }

      if (field.name === "primaryImage") {
        field.value = item.image || getProductGallery(item)[0] || "";
        return;
      }

      field.value = item[field.name] ?? "";
    });

    resetPasswordFields(form);
  }

  function resetForm(form) {
    if (!form) {
      return;
    }

    form.reset();
    const idField = form.querySelector('[name="id"]');
    if (idField) {
      idField.value = "";
    }

    resetPasswordFields(form);
  }

  function setPasswordFieldState(wrapper, visible) {
    if (!wrapper) {
      return;
    }

    const input = wrapper.querySelector("input");
    const toggle = wrapper.querySelector("[data-toggle-password]");
    if (!input || !toggle) {
      return;
    }

    input.type = visible ? "text" : "password";
    toggle.setAttribute("aria-pressed", visible ? "true" : "false");
    toggle.setAttribute("aria-label", visible ? "Ocultar senha" : "Mostrar senha");
    toggle.setAttribute("title", visible ? "Ocultar senha" : "Mostrar senha");
  }

  function resetPasswordFields(root) {
    const scope = root || document;
    scope.querySelectorAll(".field__password").forEach((wrapper) => {
      setPasswordFieldState(wrapper, false);
    });
  }

  function findItemByEntity(entity, id) {
    const source =
      entity === "users"
        ? getUsers()
        : entity === "products"
          ? getProducts()
          : entity === "suppliers"
            ? getSuppliers()
            : getEmployees();
    return source.find((item) => item.id === id) || null;
  }

  function deleteItemByEntity(entity, id) {
    if (entity === "users") {
      const users = getUsers();
      const currentUser = getCurrentUser();
      if (!currentUser || !isAdmin(currentUser)) {
        return { signedOut: false, error: "Apenas administradores podem excluir usuários." };
      }
      const target = users.find((user) => user.id === id);
      if (!target) {
        return null;
      }

      if (currentUser && currentUser.id === target.id && target.role !== "admin") {
        return { signedOut: false, error: "Você não pode excluir a própria conta logada." };
      }

      const adminCount = users.filter((user) => user.role === "admin").length;
      if (target.role === "admin" && adminCount <= 1) {
        return { signedOut: false, error: "Mantenha pelo menos um administrador ativo." };
      }

      saveUsers(deleteById(users, id));
      if (currentUser && currentUser.id === target.id) {
        clearAuthState();
        return { signedOut: true };
      }

      return { signedOut: false };
    }

    if (entity === "products") {
      saveProducts(deleteById(getProducts(), id));
      return { signedOut: false };
    }

    if (entity === "suppliers") {
      saveSuppliers(deleteById(getSuppliers(), id));
      return { signedOut: false };
    }

    if (entity === "employees") {
      saveEmployees(deleteById(getEmployees(), id));
      return { signedOut: false };
    }

    return null;
  }

  function hydrateTopbars(currentUser) {
    const cartState = currentUser ? cartSummary(currentUser.id) : null;
    const cartCount = cartQuantityCount(cartState);
    const orders = currentUser ? getOrders() : [];
    const profileOpen = document.body.classList.contains("is-profile-open");

    document.querySelectorAll(".topbar__actions").forEach((actions) => {
      actions.querySelectorAll("[data-auth-injected], [data-profile-popover]").forEach((node) => node.remove());

      const profileSlot = actions.querySelector("[data-topbar-profile-slot]");
      const accessLink = actions.querySelector("[data-topbar-auth-link]");
      const profileTrigger = profileSlot || accessLink;

      if (currentUser && profileTrigger) {
        profileTrigger.classList.add("profile-trigger");
        profileTrigger.setAttribute("data-profile-toggle", "topbar-profile");
        profileTrigger.setAttribute("aria-controls", "topbar-profile-popover");
        profileTrigger.setAttribute("aria-haspopup", "dialog");
        profileTrigger.setAttribute("aria-expanded", profileOpen ? "true" : "false");
        profileTrigger.setAttribute("aria-label", `Abrir perfil de ${currentUser.name}`);

        if (profileTrigger.tagName === "BUTTON") {
          profileTrigger.setAttribute("type", "button");
        } else {
          profileTrigger.setAttribute("href", "#");
          profileTrigger.setAttribute("role", "button");
        }

        profileTrigger.innerHTML = `
          ${renderUserAvatar(currentUser, "md")}
          <span class="profile-trigger__label">Perfil</span>
        `;
      } else if (accessLink) {
        accessLink.classList.remove("profile-trigger");
        accessLink.removeAttribute("data-profile-toggle");
        accessLink.removeAttribute("aria-controls");
        accessLink.removeAttribute("aria-haspopup");
        accessLink.removeAttribute("aria-expanded");
        accessLink.removeAttribute("role");
        accessLink.removeAttribute("type");
        accessLink.setAttribute("href", "acesso.html");
        accessLink.innerHTML = `
          <span class="btn__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 17l5-5-5-5" />
              <path d="M15 12H3" />
              <path d="M21 3v18" />
            </svg>
          </span>
          <span>Acesso</span>
        `;
      }

      if (currentUser) {
        let cartLink = actions.querySelector("[data-topbar-cart]");
        if (cartLink && cartLink.tagName !== "BUTTON") {
          const replacement = document.createElement("button");
          replacement.className = cartLink.className || "btn btn--light topbar-cart";
          cartLink.replaceWith(replacement);
          cartLink = replacement;
        }

        if (!cartLink) {
          cartLink = document.createElement("button");
          cartLink.className = "btn btn--light topbar-cart";
          cartLink.setAttribute("type", "button");
          actions.insertBefore(cartLink, profileTrigger || null);
        }

        cartLink.setAttribute("data-auth-injected", "1");
        cartLink.setAttribute("data-topbar-cart", "1");
        cartLink.setAttribute("data-cart-dialog-toggle", "1");
        cartLink.setAttribute("type", "button");
        cartLink.setAttribute("aria-controls", "cart-dialog");
        cartLink.setAttribute("aria-haspopup", "dialog");
        cartLink.setAttribute("aria-expanded", isCartDialogOpen() ? "true" : "false");
        cartLink.setAttribute(
          "aria-label",
          cartCount > 0
            ? `Abrir carrinho com ${cartCount} item${cartCount === 1 ? "" : "s"}`
            : "Abrir carrinho vazio",
        );
        cartLink.innerHTML = `
          <span class="topbar-cart__icon" aria-hidden="true">
            <span class="btn__icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6.5 7.5h11L16.7 20H7.3L6.5 7.5Z" />
                <path d="M9 7.5a3 3 0 0 1 6 0" />
                <path d="M4.5 7.5h15" />
              </svg>
            </span>
            ${cartCount > 0 ? `<span class="topbar-cart__badge" aria-hidden="true">${escapeHtml(cartCount)}</span>` : ""}
          </span>
          <span>Carrinho</span>
        `;

        if (currentUser) {
          let checkoutLink = actions.querySelector("[data-topbar-checkout]");
          if (!checkoutLink) {
            checkoutLink = document.createElement("a");
            checkoutLink.className = "btn btn--solid topbar-checkout";
            checkoutLink.setAttribute("data-auth-injected", "1");
            checkoutLink.setAttribute("data-topbar-checkout", "1");
            actions.insertBefore(checkoutLink, cartLink);
          }

          checkoutLink.href = topbarCheckoutHref();
          checkoutLink.setAttribute("aria-label", "Abrir checkout");
          checkoutLink.innerHTML = `
            <span class="topbar-action__icon" aria-hidden="true">
              ${renderButtonIcon("summary")}
            </span>
            <span>Checkout</span>
          `;
        }

        actions.querySelectorAll("[data-topbar-orders]").forEach((node) => node.remove());
      } else {
        actions.querySelectorAll("[data-topbar-cart]").forEach((node) => node.remove());
        actions.querySelectorAll("[data-topbar-checkout]").forEach((node) => node.remove());
        actions.querySelectorAll("[data-topbar-orders]").forEach((node) => node.remove());
      }

      if (currentUser) {
        actions.insertAdjacentHTML("beforeend", renderProfilePopover(currentUser, cartState, orders));
      }
    });

    syncSidebarProfile(currentUser, orders);
    syncProfilePopoverState();
  }

  function syncProfilePopoverState(open = document.body.classList.contains("is-profile-open")) {
    const isOpen = Boolean(open);

    document.querySelectorAll("[data-profile-toggle]").forEach((button) => {
      button.setAttribute("aria-expanded", isOpen ? "true" : "false");
      button.classList.toggle("is-active", isOpen);
    });

    document.querySelectorAll("[data-profile-popover]").forEach((popover) => {
      popover.toggleAttribute("hidden", !isOpen);
    });
  }

  function setProfilePopoverOpen(open) {
    const currentUser = getCurrentUser();
    const isOpen = Boolean(open) && Boolean(currentUser);
    document.body.classList.toggle("is-profile-open", isOpen);
    syncProfilePopoverState(isOpen);
  }

  function toggleProfilePopover() {
    setProfilePopoverOpen(!document.body.classList.contains("is-profile-open"));
  }

  function bindProfilePopoverActions() {
    if (document.body.dataset.profilePopoverBound === "1") {
      return;
    }

    document.body.dataset.profilePopoverBound = "1";

    document.addEventListener("click", async (event) => {
      const toggle = event.target.closest("[data-profile-toggle]");
      if (toggle) {
        event.preventDefault();
        toggleProfilePopover();
        return;
      }

      const close = event.target.closest("[data-profile-close]");
      if (close) {
        event.preventDefault();
        setProfilePopoverOpen(false);
        return;
      }

      const popoverAction = event.target.closest("[data-profile-popover] a, [data-profile-popover] button");
      if (popoverAction) {
        setProfilePopoverOpen(false);
        return;
      }

      if (!document.body.classList.contains("is-profile-open")) {
        return;
      }

      if (!event.target.closest("[data-profile-popover]")) {
        setProfilePopoverOpen(false);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && document.body.classList.contains("is-profile-open")) {
        event.preventDefault();
        setProfilePopoverOpen(false);
      }
    });
  }

  function bindLogoutActions() {
    if (document.body.dataset.logoutBound === "1") {
      return;
    }

    document.body.dataset.logoutBound = "1";

    document.addEventListener("click", async (event) => {
      const link = event.target.closest("[data-action='logout']");
      if (!link) {
        return;
      }

      event.preventDefault();
      setProfilePopoverOpen(false);
      clearAuthState();
      openAccess();
    });
  }

  function bindPasswordToggleActions() {
    if (document.body.dataset.passwordToggleBound === "1") {
      return;
    }

    document.body.dataset.passwordToggleBound = "1";

    document.addEventListener("click", async (event) => {
      const toggle = event.target.closest("[data-toggle-password]");
      if (!toggle) {
        return;
      }

      event.preventDefault();
      const wrapper = toggle.closest(".field__password");
      if (!wrapper) {
        return;
      }

      const input = wrapper.querySelector("input");
      if (!input) {
        return;
      }

      const nextVisible = input.type === "password";
      setPasswordFieldState(wrapper, nextVisible);
    });
  }

  function openAccess(next) {
    const url = new URL("acesso.html", window.location.href);
    if (next) {
      url.searchParams.set("next", next);
    }
    goTo(url.toString());
  }

  function bindAccessPage() {
    const loginForm = document.querySelector("[data-login-form]");
    const registerForm = document.querySelector("[data-register-form]");
    if (!loginForm && !registerForm) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const accessRoot = document.querySelector(".access");
    const tabButtons = accessRoot ? accessRoot.querySelectorAll("[data-access-tab]") : [];
    const panels = accessRoot ? accessRoot.querySelectorAll("[data-access-panel]") : [];
    const loginMessage = loginForm ? loginForm.querySelector("[data-login-message]") : null;
    const registerMessage = registerForm ? registerForm.querySelector("[data-register-message]") : null;
    const nextField = loginForm ? loginForm.querySelector("[data-login-next]") : null;

    if (nextField) {
      nextField.value = params.get("next") || "";
    }

    function setAccessTab(tabName) {
      const activeTab = tabName === "register" ? "register" : "login";

      tabButtons.forEach((button) => {
        const isActive = button.getAttribute("data-access-tab") === activeTab;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", isActive ? "true" : "false");
        button.tabIndex = isActive ? 0 : -1;
      });

      panels.forEach((panel) => {
        const isActive = panel.getAttribute("data-access-panel") === activeTab;
        panel.classList.toggle("is-active", isActive);
        panel.toggleAttribute("hidden", !isActive);
      });

      if (accessRoot) {
        const url = new URL(window.location.href);
        if (activeTab === "login") {
          url.searchParams.delete("tab");
        } else {
          url.searchParams.set("tab", activeTab);
        }
        window.history.replaceState({}, "", url);
      }

      resetPasswordFields(accessRoot || document);

      if (loginMessage) {
        loginMessage.textContent = "";
        loginMessage.classList.remove("is-error", "is-success");
      }

      if (registerMessage) {
        registerMessage.textContent = "";
        registerMessage.classList.remove("is-error", "is-success");
      }
    }

    setAccessTab(params.get("tab") === "register" ? "register" : "login");

    if (accessRoot) {
      accessRoot.addEventListener("click", (event) => {
        const trigger = event.target.closest("[data-access-tab], [data-access-switch]");
        if (!trigger) {
          return;
        }

        event.preventDefault();
        const nextTab = trigger.getAttribute("data-access-tab") || trigger.getAttribute("data-access-switch") || "login";
        setAccessTab(nextTab);

        const focusTarget = nextTab === "register" ? registerForm : loginForm;
        const firstField = focusTarget ? focusTarget.querySelector("input:not([type='hidden'])") : null;
        firstField?.focus({ preventScroll: true });
      });
    }

    if (loginForm && loginMessage) {
      loginForm.addEventListener("submit", (event) => {
        event.preventDefault();
        loginMessage.textContent = "";
        loginMessage.classList.remove("is-error", "is-success");

        const identifier = String(loginForm.querySelector("[data-login-identifier]")?.value || "").trim();
        const password = String(loginForm.querySelector("[data-login-password]")?.value || "").trim();
        const user = findUserByCredentials(identifier, password);

        if (!user) {
          loginMessage.textContent = "Usuário, email ou senha inválidos.";
          loginMessage.classList.add("is-error");
          return;
        }

        saveAuthState(user.id);

        const requested = targetAllowedForUser(user, nextField ? nextField.value : params.get("next") || "");
        const target = requested || defaultPageForUser(user);
        goTo(target);
      });
    }

    if (registerForm && registerMessage) {
      registerForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        registerMessage.textContent = "";
        registerMessage.classList.remove("is-error", "is-success");

        try {
          const user = await registerClientUser(registerForm);
          saveAuthState(user.id);
          registerMessage.textContent = "Conta criada com sucesso. Entrando...";
          registerMessage.classList.add("is-success");

          const requested = targetAllowedForUser(user, params.get("next") || "");
          const target = requested || defaultPageForUser(user);
          window.setTimeout(() => goTo(target), 220);
        } catch (error) {
          registerMessage.textContent = error.message || "Não foi possível criar a conta.";
          registerMessage.classList.add("is-error");
        }
      });
    }
  }

  function renderAccessRedirect(currentUser) {
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next");
    const allowed = targetAllowedForUser(currentUser, next);
    goTo(allowed || defaultPageForUser(currentUser));
  }

  function refreshVisibleUi() {
    const currentUser = getCurrentUser();
    hydrateTopbars(currentUser);
    syncCartDialogState(currentUser);
    bindLogoutActions();
    syncSidebarMetrics();
    syncSidebarToggleControls();
    renderHomeCatalog(currentUser);
    renderCatalogPage(currentUser);
    renderClientPortal(currentUser);
    renderCheckoutPage(currentUser);
    renderSellerPortal(currentUser);
    syncMenuNavigationState();
    syncCatalogStageControls();
    hydrateWhatsAppLinks();
    syncCartNoticeViews();
  }

  function bindHashNavigationSync() {
    if (document.body.dataset.hashNavigationBound === "1") {
      return;
    }

    document.body.dataset.hashNavigationBound = "1";
    window.addEventListener("hashchange", () => {
      refreshVisibleUi();
    });
  }

  function bindHomeAndCatalogActions() {
    document.addEventListener("click", (event) => {
      const catalogStageNext = event.target.closest("[data-catalog-stage-next]");
      if (catalogStageNext) {
        event.preventDefault();
        stepCatalogStage(catalogStageNext.closest("[data-catalog-stage]"), 1);
        return;
      }

      const catalogStagePrev = event.target.closest("[data-catalog-stage-prev]");
      if (catalogStagePrev) {
        event.preventDefault();
        stepCatalogStage(catalogStagePrev.closest("[data-catalog-stage]"), -1);
        return;
      }

      const carouselNext = event.target.closest("[data-catalog-carousel-next]");
      if (carouselNext) {
        event.preventDefault();
        stepCatalogCarousel(carouselNext.getAttribute("data-catalog-carousel-next"), 1);
        return;
      }

      const carouselPrev = event.target.closest("[data-catalog-carousel-prev]");
      if (carouselPrev) {
        event.preventDefault();
        stepCatalogCarousel(carouselPrev.getAttribute("data-catalog-carousel-prev"), -1);
        return;
      }

      const openProduct = event.target.closest("[data-open-product]");
      if (openProduct) {
        event.preventDefault();
        openProductLightbox(openProduct.getAttribute("data-open-product"));
        return;
      }

      const addButton = event.target.closest("[data-add-to-cart]");
      if (addButton) {
        event.preventDefault();
        addToCart(addButton.getAttribute("data-add-to-cart"), addButton);
        return;
      }

      const cartDialogToggle = event.target.closest("[data-cart-dialog-toggle]");
      if (cartDialogToggle) {
        event.preventDefault();
        if (isCartDialogOpen()) {
          closeCartDialog();
        } else {
          openCartDialog();
        }
        return;
      }

      const cartDialogClose = event.target.closest("[data-cart-dialog-close]");
      if (cartDialogClose) {
        event.preventDefault();
        closeCartDialog();
        return;
      }

      const cartViewProduct = event.target.closest("[data-cart-view-product]");
      if (cartViewProduct) {
        event.preventDefault();
        openProductLightbox(cartViewProduct.getAttribute("data-cart-view-product"));
        return;
      }

      const cartEditQuantity = event.target.closest("[data-cart-edit-quantity]");
      if (cartEditQuantity) {
        event.preventDefault();
        editCartItemQuantity(cartEditQuantity.getAttribute("data-cart-edit-quantity"));
        return;
      }

      const cartGoCatalog = event.target.closest("[data-cart-go-catalog]");
      if (cartGoCatalog) {
        event.preventDefault();
        closeCartDialog(false);
        goTo(pageLink("catalogo.html"));
        return;
      }

      const cartGoOrders = event.target.closest("[data-cart-go-orders]");
      if (cartGoOrders) {
        event.preventDefault();
        closeCartDialog(false);
        goTo(pageLink("cliente.html", "meus-pedidos"));
        return;
      }

      const cartInc = event.target.closest("[data-cart-inc]");
      if (cartInc) {
        event.preventDefault();
        changeCartItem(cartInc.getAttribute("data-cart-inc"), 1);
        return;
      }

      const cartDec = event.target.closest("[data-cart-dec]");
      if (cartDec) {
        event.preventDefault();
        changeCartItem(cartDec.getAttribute("data-cart-dec"), -1);
        return;
      }

      const cartRemove = event.target.closest("[data-cart-remove]");
      if (cartRemove) {
        event.preventDefault();
        removeCartItem(cartRemove.getAttribute("data-cart-remove"));
        return;
      }

      const cartClear = event.target.closest("[data-cart-clear]");
      if (cartClear) {
        event.preventDefault();
        clearCartItems();
        return;
      }

      const finalize = event.target.closest("[data-cart-finalize]");
      if (finalize) {
        event.preventDefault();
        finalizeOrder();
        return;
      }

      if (document.body.dataset.role !== "vendedora") {
        const scrollTarget = event.target.closest("[data-scroll-target]");
        if (scrollTarget) {
          event.preventDefault();
          const target = document.querySelector(`[data-crud-panel="${scrollTarget.getAttribute("data-scroll-target")}"]`);
          target?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    });
  }

  function bindProductLightboxActions() {
    if (document.body.dataset.productLightboxBound === "1") {
      return;
    }

    document.body.dataset.productLightboxBound = "1";

    document.addEventListener("click", (event) => {
      const closeButton = event.target.closest("[data-product-lightbox-close]");
      if (closeButton) {
        event.preventDefault();
        closeProductLightbox();
        return;
      }

      const prevButton = event.target.closest("[data-product-lightbox-prev]");
      if (prevButton) {
        event.preventDefault();
        stepProductLightbox(-1);
        return;
      }

      const nextButton = event.target.closest("[data-product-lightbox-next]");
      if (nextButton) {
        event.preventDefault();
        stepProductLightbox(1);
        return;
      }

      const thumbButton = event.target.closest("[data-product-lightbox-thumb]");
      if (thumbButton) {
        event.preventDefault();
        const index = Number(thumbButton.getAttribute("data-product-lightbox-thumb"));
        const product = getProducts().find((item) => item.id === productLightboxState.productId);
        if (product) {
          renderProductLightbox(product, Number.isFinite(index) ? index : 0);
        }
      }
    });

    document.addEventListener("keydown", (event) => {
      const openProduct = event.target.closest("[data-open-product]");
      if (openProduct && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        openProductLightbox(openProduct.getAttribute("data-open-product"));
        return;
      }

      if (event.key === "Escape") {
        if (document.body.classList.contains("is-lightbox-open")) {
          event.preventDefault();
          closeProductLightbox();
          return;
        }

        if (document.body.classList.contains("is-cart-dialog-open")) {
          event.preventDefault();
          closeCartDialog();
          return;
        }
      }

      if (!document.body.classList.contains("is-lightbox-open")) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepProductLightbox(-1);
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        stepProductLightbox(1);
      }
    });
  }

  function bindSellerActions() {
    if (document.body.dataset.sellerBound === "1") {
      return;
    }

    document.body.dataset.sellerBound = "1";

    document.addEventListener("click", async (event) => {
      const tabBtn = event.target.closest("[data-crud-tab]");
      if (tabBtn) {
        event.preventDefault();
        setSellerCrudTab(tabBtn.getAttribute("data-crud-tab"));
        return;
      }

      const mediaThumb = event.target.closest("[data-product-media-thumb]");
      if (mediaThumb) {
        event.preventDefault();
        const panel = mediaThumb.closest("[data-crud-panel='products']");
        const form = panel ? panel.querySelector("[data-crud-form='products']") : null;
        const primaryField = form ? form.querySelector('[name="primaryImage"]') : null;
        if (primaryField) {
          primaryField.value = mediaThumb.getAttribute("data-product-media-thumb") || "";
          void updateProductPreview(form);
        }
        return;
      }

      const editBtn = event.target.closest("[data-crud-edit]");
      if (editBtn) {
        event.preventDefault();
        const entity = editBtn.getAttribute("data-crud-edit");
        const id = editBtn.getAttribute("data-id");
        const item = findItemByEntity(entity, id);
        const form = document.querySelector(`[data-crud-form="${entity}"]`);
        if (item && form) {
          setSellerCrudTab(entity);
          fillForm(form, item);
          form.querySelector('[name="id"]').value = item.id;
          if (entity === "products") {
            void updateProductPreview(form);
          }
          window.requestAnimationFrame(() => {
            form.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }
        return;
      }

      const deleteBtn = event.target.closest("[data-crud-delete]");
      if (deleteBtn) {
        event.preventDefault();
        const entity = deleteBtn.getAttribute("data-crud-delete");
        const id = deleteBtn.getAttribute("data-id");
        const confirmed = await showUiConfirm("Excluir este registro?", {
          title: "Excluir registro",
          confirmLabel: "Excluir",
          cancelLabel: "Cancelar",
          tone: "danger",
        });
        if (!confirmed) {
          return;
        }

        const result = deleteItemByEntity(entity, id);
        if (!result) {
          return;
        }

        if (result.error) {
          await showUiAlert(result.error, {
            title: "Ação bloqueada",
            tone: "danger",
          });
          return;
        }

        if (result.signedOut) {
          openAccess();
          return;
        }

        refreshVisibleUi();
        return;
      }

      const resetBtn = event.target.closest("[data-reset-form]");
      if (resetBtn) {
        event.preventDefault();
        const entity = resetBtn.getAttribute("data-reset-form");
        const form = entity === "contact"
          ? document.querySelector("[data-settings-form='contact']")
          : document.querySelector(`[data-crud-form="${entity}"]`);
        if (entity) {
          setSellerCrudTab(entity);
        }
        resetForm(form);
        if (entity === "products" && form) {
          void updateProductPreview(form);
        }
        return;
      }

      const scrollTarget = event.target.closest("[data-scroll-target]");
      if (scrollTarget) {
        event.preventDefault();
        const tabName = scrollTarget.getAttribute("data-scroll-target");
        const crudTarget = document.querySelector(`[data-crud-panel="${tabName}"]`);
        if (crudTarget) {
          setSellerCrudTab(tabName);
          window.requestAnimationFrame(() => {
            crudTarget.scrollIntoView({ behavior: "smooth", block: "start" });
            setLocationHash("cadastros");
          });
          return;
        }

        const sectionTarget = document.getElementById(tabName);
        if (sectionTarget) {
          window.requestAnimationFrame(() => {
            sectionTarget.scrollIntoView({ behavior: "smooth", block: "start" });
            setLocationHash(tabName === "contact" ? "contato" : tabName);
          });
        }
      }
    });

    document.addEventListener("input", (event) => {
      const form = event.target.closest("[data-crud-form='products']");
      if (form) {
        void updateProductPreview(form);
      }
    });

    document.addEventListener("change", (event) => {
      const form = event.target.closest("[data-crud-form='products']");
      if (form) {
        void updateProductPreview(form);
        return;
      }

      const statusSelect = event.target.closest("[data-order-status-select]");
      if (statusSelect) {
        const orderId = statusSelect.getAttribute("data-order-id");
        if (orderId && updateOrderStatus(orderId, statusSelect.value)) {
          refreshVisibleUi();
        }
      }
    });

    document.addEventListener("submit", async (event) => {
      const settingsForm = event.target.closest("[data-settings-form]");
      if (settingsForm) {
        event.preventDefault();
        try {
          saveStoreSettings(settingsForm);
          refreshVisibleUi();
        } catch (error) {
          await showUiAlert(error.message || "Não foi possível salvar o contato.", {
            title: "Não foi possível salvar",
            tone: "danger",
          });
        }
        return;
      }

      const form = event.target.closest("[data-crud-form]");
      if (!form) {
        return;
      }

      event.preventDefault();
      try {
        const entity = form.getAttribute("data-crud-form");
        if (entity === "users") {
          await saveOrUpdateUser(form);
        } else if (entity === "products") {
          await saveOrUpdateProduct(form);
        } else if (entity === "suppliers") {
          await saveOrUpdateSupplier(form);
        } else if (entity === "employees") {
          await saveOrUpdateEmployee(form);
        }

        const currentUser = getCurrentUser();
        refreshVisibleUi();
        if (entity === "users" && currentUser && !isAdmin(currentUser)) {
          openAccess("cliente.html");
        }
      } catch (error) {
        await showUiAlert(error.message || "Não foi possível salvar o registro.", {
          title: "Não foi possível salvar",
          tone: "danger",
        });
      }
    });
  }

  function bindClientActions() {
    const root = document.querySelector("[data-client-portal]");
    if (!root || root.dataset.bound === "1") {
      return;
    }

    root.dataset.bound = "1";

    root.addEventListener("click", (event) => {
      const addButton = event.target.closest("[data-add-to-cart]");
      if (addButton) {
        event.preventDefault();
        addToCart(addButton.getAttribute("data-add-to-cart"), addButton);
        return;
      }
    });
  }

  function bindCheckoutActions() {
    if (document.body.dataset.checkoutBound === "1") {
      return;
    }

    document.body.dataset.checkoutBound = "1";

    document.addEventListener("input", (event) => {
      const form = event.target.closest("[data-checkout-form]");
      if (!form) {
        return;
      }

      updateCheckoutPaymentSections(form);
      scheduleCheckoutProfileSave(form);
    });

    document.addEventListener("click", async (event) => {
      const copyButton = event.target.closest("[data-copy-pix]");
      if (!copyButton) {
        return;
      }

      event.preventDefault();

      const value = String(copyButton.getAttribute("data-copy-pix-value") || "").trim();
      if (!value) {
        await showUiAlert("Nenhum dado Pix foi configurado para copiar.", {
          title: "Pix indisponível",
          tone: "danger",
        });
        return;
      }

      const feedback = copyButton.parentElement?.querySelector("[data-copy-pix-feedback]");
      const originalLabel = String(copyButton.getAttribute("data-original-label") || copyButton.textContent || "Copiar Pix").trim();

      try {
        const copied = await copyTextToClipboard(value);
        if (!copied) {
          throw new Error("copy_failed");
        }

        copyButton.classList.add("is-copied");
        copyButton.textContent = "Copiado";
        if (feedback) {
          feedback.textContent = "Pix copiado para a area de transferencia.";
        }

        if (copyButton._copyResetTimer) {
          window.clearTimeout(copyButton._copyResetTimer);
        }

        copyButton._copyResetTimer = window.setTimeout(() => {
          copyButton.classList.remove("is-copied");
          copyButton.textContent = originalLabel;
          if (feedback) {
            feedback.textContent = "";
          }
        }, 1800);
      } catch (_error) {
        await showUiAlert("Não foi possível copiar o Pix. Tente novamente.", {
          title: "Falha ao copiar",
          tone: "danger",
        });
      }
    });

    document.addEventListener("change", (event) => {
      const form = event.target.closest("[data-checkout-form]");
      if (!form) {
        return;
      }

      updateCheckoutPaymentSections(form);
      scheduleCheckoutProfileSave(form);
    });

    document.addEventListener("submit", async (event) => {
      const form = event.target.closest("[data-checkout-form]");
      if (!form) {
        return;
      }

      event.preventDefault();
      updateCheckoutPaymentSections(form);
      await completeCheckoutPayment(form);
    });
  }

  function bindStorageSync() {
    if (document.body.dataset.storageSyncBound === "1") {
      return;
    }

    document.body.dataset.storageSyncBound = "1";

    window.addEventListener("storage", (event) => {
      if (event.key && !STORAGE_KEY_SET.has(event.key)) {
        return;
      }

      const currentUser = getCurrentUser();
      if (applyGuards(currentUser)) {
        return;
      }

      refreshVisibleUi();
    });
  }

  function applyGuards(currentUser) {
    const body = document.body;
    const page = currentPageName();

    if (body.dataset.page === "access") {
      if (currentUser) {
        renderAccessRedirect(currentUser);
        return true;
      }
      return false;
    }

    if (page === "checkout.html") {
      if (!currentUser) {
        openAccess("checkout.html");
        return true;
      }
    }

    const requiredRole = body.dataset.role;
    if (requiredRole === "cliente" && !currentUser) {
      openAccess("cliente.html");
      return true;
    }

    if (requiredRole === "vendedora") {
      if (!currentUser) {
        openAccess("vendedora.html");
        return true;
      }

      if (!isAdmin(currentUser)) {
        openAccess("cliente.html");
        return true;
      }
    }

    return false;
  }

  async function init() {
    ensureSeededStorage();
    await loadStoreFromServer();
    const currentUser = getCurrentUser();

    if (applyGuards(currentUser)) {
      return;
    }

    bindPasswordToggleActions();
    initializeSidebarState();
    bindSidebarToggleActions();
    bindUiDialogActions();
    bindCatalogScrollActions();
    bindHomeAndCatalogActions();
    bindProductLightboxActions();
    bindAccessPage();
    bindProfilePopoverActions();
    bindHashNavigationSync();
    refreshVisibleUi();
    bindClientActions();
    bindCheckoutActions();
    bindSellerActions();
    bindStorageSync();
  }

  window.vzStore = {
    refresh: refreshVisibleUi,
  };

  document.addEventListener("DOMContentLoaded", () => {
    init().catch(() => {
      
    });
  });
})();
