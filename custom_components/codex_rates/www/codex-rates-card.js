/**
 * Codex-LB Rates Lovelace card — pool + remaining %.
 *
 * Consumes existing remaining-% sensors (pool or account). No new entities.
 *
 * Example:
 *   type: custom:codex-rates-card
 *   title: Codex pool
 *   entity: sensor.codex_lb_pool_all_accounts_5h_remaining
 *   entities:
 *     - sensor.codex_lb_pool_all_accounts_weekly_remaining
 *     - entity: sensor.my_account_5h_remaining
 *       name: Account A
 */
(() => {
  const CARD_TYPE = "codex-rates-card";
  const EDITOR_TYPE = "codex-rates-card-editor";
  // Bump when editor/card surface changes so console + digest cache-bust clearly.
  const CARD_VERSION = "1.2.0";

  /** @param {number} value */
  function clampPercent(value) {
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.min(100, value));
  }

  /** @param {unknown} state */
  function parseRemaining(state) {
    if (state === undefined || state === null) return null;
    if (typeof state === "number") return clampPercent(state);
    const text = String(state).trim();
    if (!text || text === "unknown" || text === "unavailable") return null;
    const parsed = Number.parseFloat(text);
    return clampPercent(parsed);
  }

  /**
   * Remaining-% colour bands (plenty / getting low / little left).
   * @param {number | null} value
   * @param {{ green?: number, yellow?: number }} thresholds
   */
  function bandColor(value, thresholds) {
    if (value === null) return "var(--disabled-text-color)";
    const green = thresholds.green ?? 50;
    const yellow = thresholds.yellow ?? 20;
    if (value >= green) return "var(--success-color, #48c9b0)";
    if (value >= yellow) return "var(--warning-color, #f0c14b)";
    return "var(--error-color, #e4572e)";
  }

  /**
   * @param {Record<string, unknown>} config
   * @returns {{ entity: string, name?: string }[]}
   */
  function normalizeEntities(config) {
    /** @type {{ entity: string, name?: string }[]} */
    const rows = [];
    if (config.entity) {
      rows.push({ entity: String(config.entity), name: config.name ? String(config.name) : undefined });
    }
    const list = Array.isArray(config.entities) ? config.entities : [];
    for (const item of list) {
      if (typeof item === "string") {
        rows.push({ entity: item });
        continue;
      }
      if (item && typeof item === "object" && item.entity) {
        rows.push({
          entity: String(item.entity),
          name: item.name ? String(item.name) : undefined,
        });
      }
    }
    return rows;
  }

  /** @param {unknown} value */
  function formatOptionalNumber(value) {
    if (value === undefined || value === null || value === "") return null;
    const num = typeof value === "number" ? value : Number.parseFloat(String(value));
    if (Number.isNaN(num)) return String(value);
    return Number.isInteger(num) ? String(num) : num.toFixed(1);
  }

  /** Format provider timestamps; never infer a reset from the quota percentage. */
  function formatReset(stateObj, mode, hass) {
    if (parseRemaining(stateObj?.state) === null) return "Unavailable";
    const attrs = stateObj.attributes || {};
    const pool = attrs.next_reset_at !== undefined || attrs.reset_sample_count !== undefined;
    const timestamp = pool ? attrs.next_reset_at : attrs.resets_at;
    const reset = typeof timestamp === "string" && timestamp.trim() ? Date.parse(timestamp) : NaN;
    if (!Number.isFinite(reset)) return "Reset time unavailable";
    if (reset <= Date.now()) return pool ? "Next reset due · awaiting update" : "Reset due · awaiting update";
    const prefix = pool ? "Next reset" : "Resets";
    if (mode === "absolute") {
      const locale = hass?.locale;
      const options = {
        weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
        timeZone: locale?.time_zone === "local" ? undefined : hass?.config?.time_zone,
      };
      if (locale?.time_format === "24") options.hourCycle = "h23";
      if (locale?.time_format === "12") options.hourCycle = "h12";
      if (locale?.time_format === "system") {
        options.hourCycle = new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle;
      }
      return `${prefix} at ${new Intl.DateTimeFormat(locale?.language || undefined, options).format(reset)}`;
    }
    const minutes = Math.ceil((reset - Date.now()) / 60000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = String(minutes % 60).padStart(2, "0");
    const duration = days ? `${days}d ${String(hours).padStart(2, "0")}h ${mins}m` : `${hours}h ${mins}m`;
    return `${pool ? "Next reset" : "Resets"} in ${duration}`;
  }

  /**
   * Object-form `entities` rows stay YAML-only — the multi entity selector
   * expects string[]. Throwing disables the visual editor for that config.
   * @param {Record<string, unknown> | null | undefined} config
   */
  function assertConfig(config) {
    const list = Array.isArray(config?.entities) ? config.entities : [];
    for (const item of list) {
      if (typeof item !== "string") {
        throw new Error(
          "Object-form entities (including per-row names) are only editable in YAML; use the code editor."
        );
      }
    }
  }

  /** @param {{ name?: string }} schema */
  function computeLabel(schema) {
    switch (schema.name) {
      case "title":
        return "Title";
      case "theme":
        return "Theme";
      case "reset_display":
        return "Reset display";
      case "entity":
        return "Primary remaining entity";
      case "name":
        return "Primary name override";
      case "entities":
        return "Additional remaining entities";
      case "green":
        return "Green threshold (%)";
      case "yellow":
        return "Yellow threshold (%)";
      default:
        return undefined;
    }
  }

  /** @param {{ name?: string }} schema */
  function computeHelper(schema) {
    switch (schema.name) {
      case "entity":
        return "Large remaining-% value and progress bar. At least one of primary or additional entities is required.";
      case "theme":
        return "Optional card theme. Leave empty to use the dashboard theme.";
      case "reset_display":
        return "Countdown (default), reset date/time in Home Assistant's time zone, or hidden. Pools show the next known account reset.";
      case "name":
        return "Optional label for the primary entity only.";
      case "entities":
        return "Extra rows under the primary (entity IDs only). Object-form rows with optional names still need YAML.";
      case "green":
      case "yellow":
        return "Colour bands: ≥ green = plenty; ≥ yellow = getting low; else little left. Defaults 50 / 20.";
      default:
        return undefined;
    }
  }

  const CONFIG_FORM_SCHEMA = [
    { name: "title", selector: { text: {} } },
    { name: "theme", selector: { theme: {} } },
    {
      name: "reset_display",
      selector: { select: { mode: "dropdown", options: [
        { value: "countdown", label: "Countdown" },
        { value: "absolute", label: "Reset date/time" },
        { value: "hidden", label: "Hidden" },
      ] } },
    },
    {
      name: "entity",
      selector: {
        entity: {
          domain: "sensor",
        },
      },
    },
    { name: "name", selector: { text: {} } },
    {
      name: "entities",
      selector: {
        entity: {
          multiple: true,
          domain: "sensor",
        },
      },
    },
    {
      type: "grid",
      name: "",
      flatten: true,
      schema: [
        {
          name: "green",
          selector: { number: { min: 0, max: 100, mode: "box" } },
        },
        {
          name: "yellow",
          selector: { number: { min: 0, max: 100, mode: "box" } },
        },
      ],
    },
  ];

  function getConfigForm() {
    return {
      schema: CONFIG_FORM_SCHEMA,
      computeLabel,
      computeHelper,
      assertConfig,
    };
  }

  /**
   * Compact visual editor — HA prefers getConfigElement over getConfigForm.
   * Uses frontend ha-form (always present in the card editor dialog).
   */
  class CodexRatesCardEditor extends HTMLElement {
    constructor() {
      super();
      /** @type {Record<string, unknown>} */
      this._config = {};
      /** @type {any} */
      this._hass = undefined;
      /** @type {any} */
      this._form = undefined;
    }

    /** @param {Record<string, unknown>} config */
    setConfig(config) {
      assertConfig(config);
      this._config = { ...config };
      this._ensureForm();
      if (this._form) {
        this._form.data = this._config;
      }
    }

    /** @param {any} hass */
    set hass(hass) {
      this._hass = hass;
      if (this._form) {
        this._form.hass = hass;
      }
    }

    connectedCallback() {
      this._ensureForm();
    }

    _ensureForm() {
      if (this._form || !this.isConnected) return;
      const form = document.createElement("ha-form");
      form.schema = CONFIG_FORM_SCHEMA;
      form.computeLabel = computeLabel;
      form.computeHelper = computeHelper;
      form.data = this._config;
      if (this._hass) {
        form.hass = this._hass;
      }
      form.addEventListener("value-changed", (ev) => {
        ev.stopPropagation();
        const value = ev.detail?.value || {};
        const config = { ...this._config, ...value };
        if (this._config.type) {
          config.type = this._config.type;
        }
        this._config = config;
        this.dispatchEvent(
          new CustomEvent("config-changed", {
            detail: { config },
            bubbles: true,
            composed: true,
          })
        );
      });
      this._form = form;
      this.appendChild(form);
    }
  }

  class CodexRatesCard extends HTMLElement {
    constructor() {
      super();
      /** @type {Record<string, unknown> | null} */
      this._config = null;
      /** @type {any} */
      this._hass = null;
      this._root = this.attachShadow({ mode: "open" });
      this._style = this._root.appendChild(document.createElement("style"));
      this._card = this._root.appendChild(document.createElement("ha-card"));
      this._content = this._card.appendChild(document.createElement("div"));
      this._content.className = "content";
      this._themeKeys = [];
      this._timer = undefined;
    }

    static getStubConfig() {
      return {
        type: `custom:${CARD_TYPE}`,
        title: "Codex remaining",
        entity: "sensor.codex_lb_pool_all_accounts_5h_remaining",
        entities: ["sensor.codex_lb_pool_all_accounts_weekly_remaining"],
      };
    }

    /** Built-in ha-form schema (HA ≈2023.5+ fallback if getConfigElement is ignored). */
    static getConfigForm() {
      return getConfigForm();
    }

    /** Preferred Lovelace visual editor hook. */
    static getConfigElement() {
      return document.createElement(EDITOR_TYPE);
    }

    /** @param {Record<string, unknown>} config */
    setConfig(config) {
      if (!config || typeof config !== "object") {
        throw new Error("Invalid configuration");
      }
      const entities = normalizeEntities(config);
      if (!entities.length) {
        throw new Error("Set at least one remaining-% entity");
      }
      if (config.reset_display && !["countdown", "absolute", "hidden"].includes(config.reset_display)) {
        throw new Error("reset_display must be countdown, absolute, or hidden");
      }
      this._config = { ...config, _entities: entities };
      this._applyTheme();
      this._syncTimer();
      this._render();
    }

    /** @param {any} hass */
    set hass(hass) {
      this._hass = hass;
      this._applyTheme();
      this._render();
    }

    connectedCallback() {
      this._syncTimer();
      this._updateResetTimes();
    }

    disconnectedCallback() {
      clearInterval(this._timer);
      this._timer = undefined;
    }

    _syncTimer() {
      this.disconnectedCallback();
      if (this.isConnected && this._config && (this._config.reset_display || "countdown") === "countdown") {
        this._timer = setInterval(() => this._updateResetTimes(), 60000);
      }
    }

    _updateResetTimes() {
      for (const element of this._content.querySelectorAll(".reset[data-entity]")) {
        element.textContent = formatReset(this._hass?.states?.[element.dataset.entity], this._config?.reset_display, this._hass);
      }
    }

    _applyTheme() {
      const theme = this._hass?.themes?.themes?.[this._config?.theme];
      const { modes, ...base } = theme || {};
      const mode = this._hass?.themes?.darkMode ? "dark" : "light";
      const variables = { ...base, ...modes?.[mode] };
      for (const key of this._themeKeys) this.style.removeProperty(`--${key}`);
      this._themeKeys = Object.keys(variables);
      for (const [key, value] of Object.entries(variables)) this.style.setProperty(`--${key}`, String(value));
    }

    _resetHtml(entity, stateObj, index) {
      if (this._config.reset_display === "hidden") return "";
      return `<span id="reset-${index}" class="reset" data-entity="${this._escape(entity)}">${this._escape(formatReset(stateObj, this._config.reset_display, this._hass))}</span>`;
    }

    getCardSize() {
      const entities = /** @type {{ entity: string }[]} */ (this._config?._entities || []);
      return Math.max(2, 1 + entities.length);
    }

    _render() {
      if (!this._config || !this._root) return;

      const entities = /** @type {{ entity: string, name?: string }[]} */ (
        this._config._entities || []
      );
      const primary = entities[0];
      const rest = entities.slice(1);
      const thresholds = {
        green: Number(this._config.green ?? 50),
        yellow: Number(this._config.yellow ?? 20),
      };
      const title =
        (this._config.title && String(this._config.title)) ||
        primary.name ||
        "Codex remaining";

      const primaryState = this._hass?.states?.[primary.entity];
      const primaryValue = parseRemaining(primaryState?.state);
      const primaryName =
        primary.name ||
        primaryState?.attributes?.friendly_name ||
        primary.entity;
      const color = bandColor(primaryValue, thresholds);
      const barWidth = primaryValue === null ? 0 : primaryValue;

      const attrs = primaryState?.attributes || {};
      const metaParts = [];
      const samples = formatOptionalNumber(attrs.sample_count);
      if (samples !== null) metaParts.push(`${samples} measured`);
      const weighting = attrs.weighting_method ? String(attrs.weighting_method) : null;
      if (weighting) metaParts.push(weighting.replaceAll("_", " "));
      if (Number.isFinite(attrs.reset_sample_count) && Number.isFinite(attrs.sample_count) && attrs.reset_sample_count < attrs.sample_count) {
        metaParts.push(`reset times for ${attrs.reset_sample_count}/${attrs.sample_count} accounts`);
      }

      const rowsHtml = rest
        .map((row, index) => {
          const stateObj = this._hass?.states?.[row.entity];
          const value = parseRemaining(stateObj?.state);
          const label =
            row.name || stateObj?.attributes?.friendly_name || row.entity;
          const rowColor = bandColor(value, thresholds);
          const display = value === null ? "—" : `${value.toFixed(value % 1 ? 1 : 0)}%`;
          const unavailable = value === null;
          return `
            <button type="button" class="row${unavailable ? " muted" : ""}" data-entity="${this._escape(row.entity)}"
                    ${this._config.reset_display === "hidden" ? "" : `aria-describedby="reset-${index + 1}"`}
                    aria-label="${this._escape(label)}: ${display}. More info">
              <span class="row-details"><span class="row-name">${this._escape(label)}</span>${this._resetHtml(row.entity, stateObj, index + 1)}</span>
              <span class="row-value" style="color:${rowColor}">${display}</span>
            </button>
          `;
        })
        .join("");

      const primaryDisplay =
        primaryValue === null
          ? "—"
          : `${primaryValue.toFixed(primaryValue % 1 ? 1 : 0)}%`;

      this._style.textContent = `
          :host {
            display: block;
          }
          ha-card {
            --codex-accent: ${color};
            padding: 16px;
            overflow: hidden;
          }
          button {
            width: 100%;
            background: none;
            border: none;
            padding: 0;
            color: inherit;
            font: inherit;
            text-align: start;
            cursor: pointer;
          }
          button:focus-visible {
            outline: 2px solid var(--primary-color);
            outline-offset: 3px;
          }
          .header {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 8px;
          }
          .title {
            font-size: 1.05rem;
            font-weight: 500;
            color: var(--ha-card-header-color, var(--primary-text-color));
            line-height: 1.3;
          }
          .subtitle {
            font-size: 0.8rem;
            color: var(--secondary-text-color);
            margin-top: 2px;
            overflow-wrap: anywhere;
          }
          .hero {
            display: flex;
            align-items: flex-end;
            justify-content: space-between;
            gap: 12px;
            margin: 4px 0 12px;
          }
          .pct {
            font-size: 2.4rem;
            font-weight: 600;
            letter-spacing: -0.02em;
            line-height: 1;
            color: var(--codex-accent);
            font-variant-numeric: tabular-nums;
          }
          .pct-label {
            font-size: 0.75rem;
            color: var(--secondary-text-color);
            text-align: right;
            max-width: 45%;
          }
          .bar {
            height: 8px;
            border-radius: 999px;
            background: color-mix(in srgb, var(--divider-color) 70%, transparent);
            overflow: hidden;
            margin-bottom: 10px;
          }
          .bar > span {
            display: block;
            height: 100%;
            width: ${barWidth}%;
            border-radius: inherit;
            background: var(--codex-accent);
            transition: width 0.35s ease;
          }
          .meta {
            font-size: 0.75rem;
            color: var(--secondary-text-color);
            margin-bottom: ${rowsHtml ? "12px" : "0"};
          }
          .reset {
            display: block;
            font-size: 0.75rem;
            line-height: 1.5;
            color: var(--secondary-text-color);
            font-variant-numeric: tabular-nums;
            overflow-wrap: anywhere;
          }
          .primary-reset { margin-bottom: 8px; }
          .rows {
            display: flex;
            flex-direction: column;
            gap: 8px;
            border-top: 1px solid var(--divider-color);
            padding-top: 10px;
          }
          .row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            font-size: 0.92rem;
          }
          .row.muted .row-value {
            color: var(--disabled-text-color) !important;
          }
          .row-name {
            display: block;
            color: var(--primary-text-color);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .row-details { min-width: 0; }
          .row-value {
            font-weight: 600;
            font-variant-numeric: tabular-nums;
            flex-shrink: 0;
          }
          .warning {
            color: var(--error-color);
            font-size: 0.85rem;
            margin-top: 8px;
          }
      `;
      const focusedEntity = this._root.activeElement?.dataset?.entity;
      this._content.innerHTML = `
          <div class="header">
            <div>
              <div class="title">${this._escape(title)}</div>
              <div class="subtitle">${this._escape(primaryName)}</div>
            </div>
          </div>
          <button type="button" class="hero" data-entity="${this._escape(primary.entity)}"
                  ${this._config.reset_display === "hidden" ? "" : 'aria-describedby="reset-0"'}
                  aria-label="${this._escape(primaryName)}: ${primaryDisplay}. More info">
            <div class="pct">${primaryDisplay}</div>
            <div class="pct-label">${primaryValue === null ? "Unavailable" : "remaining"}</div>
          </button>
          <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"
               ${primaryValue === null ? 'aria-valuetext="Unavailable"' : `aria-valuenow="${primaryValue}"`}
               aria-label="${this._escape(primaryName)} remaining">
            <span></span>
          </div>
          ${this._config.reset_display === "hidden" ? "" : `<div class="primary-reset">${this._resetHtml(primary.entity, primaryState, 0)}</div>`}
          ${
            metaParts.length
              ? `<div class="meta">${this._escape(metaParts.join(" · "))}</div>`
              : ""
          }
          ${rowsHtml ? `<div class="rows">${rowsHtml}</div>` : ""}
          ${
            !this._hass
              ? ""
              : !primaryState
                ? `<div class="warning">Entity not found: ${this._escape(primary.entity)}</div>`
                : ""
          }
      `;
      for (const button of this._content.querySelectorAll("button[data-entity]")) {
        if (focusedEntity && button.dataset.entity === focusedEntity) button.focus({ preventScroll: true });
        button.addEventListener("click", () => {
          this.dispatchEvent(new CustomEvent("hass-more-info", {
            detail: { entityId: button.dataset.entity }, bubbles: true, composed: true,
          }));
        });
      }
    }

    /** @param {string} value */
    _escape(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }
  }

  if (!customElements.get(EDITOR_TYPE)) {
    customElements.define(EDITOR_TYPE, CodexRatesCardEditor);
  }

  if (!customElements.get(CARD_TYPE)) {
    customElements.define(CARD_TYPE, CodexRatesCard);
  }

  // Always re-attach editor hooks on the *live* custom element class.
  // After upgrades, an older bundle may already have registered the tag;
  // customElements.define is then a no-op and HA would keep seeing a class
  // without getConfigForm/getConfigElement ("Visual editor not supported").
  const LiveCard = customElements.get(CARD_TYPE);
  if (LiveCard) {
    LiveCard.getConfigForm = getConfigForm;
    LiveCard.getConfigElement = () => document.createElement(EDITOR_TYPE);
    LiveCard.getStubConfig = CodexRatesCard.getStubConfig;
  }

  window.customCards = window.customCards || [];
  if (!window.customCards.some((card) => card.type === CARD_TYPE)) {
    window.customCards.push({
      type: CARD_TYPE,
      name: "Codex-LB Rates remaining",
      description: "Pool and account remaining-% at a glance.",
      preview: true,
      documentationURL: "https://github.com/uniskela/codex-lb-rates",
    });
  }

  console.info(
    `%c Codex-LB Rates card %c v${CARD_VERSION} `,
    "background:#0f2830;color:#48c9b0;padding:2px 4px;border-radius:4px 0 0 4px;",
    "background:#48c9b0;color:#0f2830;padding:2px 4px;border-radius:0 4px 4px 0;"
  );
})();
