const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
process.env.TZ = "UTC";

const bundle = fs.readFileSync(path.join(__dirname, "../custom_components/codex_rates/www/codex-rates-card.js"), "utf8");
const NOW = Date.parse("2026-10-12T09:00:00Z");

function setup(config = {}) {
  let now = NOW;
  const elements = new Map();
  const timers = new Map();
  class Element {
    constructor() {
      this.style = {
        values: {},
        setProperty(key, value) { this.values[key] = String(value); },
        removeProperty(key) { delete this.values[key]; },
      };
      this.children = [];
      this.innerHTML = "";
      this.isConnected = true;
    }
    attachShadow() { return new Element(); }
    appendChild(child) { this.children.push(child); return child; }
    querySelector(selector) {
      return this.children.find((child) => child.tagName === selector || `.${child.className}` === selector) || null;
    }
    querySelectorAll() { return []; }
    addEventListener() {}
    dispatchEvent(event) { this.event = event; }
  }
  vm.runInNewContext(bundle, {
    HTMLElement: Element,
    customElements: { get: (name) => elements.get(name), define: (name, cls) => elements.set(name, cls) },
    document: { createElement: (tagName) => Object.assign(new Element(), { tagName }) },
    window: {}, console: { info() {} },
    Date: class extends Date { static now() { return now; } },
    Intl,
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    setInterval: (fn, delay) => { timers.set(1, { fn, delay }); return 1; },
    clearInterval: (id) => timers.delete(id),
  });
  const Card = elements.get("codex-rates-card");
  const card = new Card();
  card.setConfig({ entity: "sensor.primary", entities: ["sensor.weekly"], ...config });
  const hass = {
    locale: { language: "en", time_format: "24" }, config: { time_zone: "Australia/Sydney" },
    states: {
      "sensor.primary": { state: "100", attributes: { friendly_name: "Primary", next_reset_at: "2026-10-12T13:07:00Z", min: 80, max: 100 } },
      "sensor.weekly": { state: "76", attributes: { friendly_name: "Weekly", next_reset_at: "2026-10-15T11:05:00Z" } },
    },
    themes: { darkMode: true, themes: {
      Frosted: { "ha-card-background": "rgba(20,24,30,.6)", "ha-card-border-radius": "18px", modes: {
        dark: { "primary-text-color": "#fff" }, light: { "primary-text-color": "#111" },
      } }, Other: { "primary-text-color": "#abc" },
    } },
  };
  card.hass = hass;
  return { card, hass, timers, Card, setNow: (value) => { now = value; } };
}

const html = (card) => card._root.querySelector("ha-card")?.querySelector(".content")?.innerHTML ?? card._root.innerHTML;

test("primary and weekly rows show countdowns instead of pool min/max", () => {
  const { card } = setup();
  assert.match(html(card), /Next reset in 4h 07m/);
  assert.match(html(card), /Next reset in 3d 02h 05m/);
  assert.doesNotMatch(html(card), /min 80%/);
});

test("account reset, sub-minute, due, missing and unavailable states stay honest", () => {
  const { card, hass } = setup();
  const attrs = hass.states["sensor.primary"].attributes;
  delete attrs.next_reset_at;
  attrs.resets_at = "2026-10-12T09:00:01Z";
  card.hass = hass;
  assert.match(html(card), /Resets in 0h 01m/);
  attrs.resets_at = "2026-10-12T09:00:00Z";
  card.hass = hass;
  assert.match(html(card), /Reset due/);
  for (const invalid of [undefined, null, "", "invalid"]) {
    attrs.resets_at = invalid;
    card.hass = hass;
    assert.match(html(card), /Reset time unavailable/);
  }
  hass.states["sensor.primary"].state = "unavailable";
  attrs.resets_at = "2099-01-01T00:00:00Z";
  card.hass = hass;
  assert.match(html(card), /Unavailable/);
  assert.doesNotMatch(html(card), /aria-valuenow=""/);
  assert.doesNotMatch(html(card), /Resets in/);
});

test("absolute display uses HA timezone and offers a hidden mode", () => {
  const { card } = setup({ reset_display: "absolute" });
  assert.match(html(card), /Next reset at/);
  assert.match(html(card), /00:07/); // 13:07 UTC is midnight next day in Sydney (UTC+11).
  assert.doesNotMatch(html(card), /Next reset in/);
  card.setConfig({ entity: "sensor.primary", reset_display: "hidden" });
  assert.doesNotMatch(html(card), /Next reset|Reset time/);
});

test("absolute time respects local timezone and 12-hour preference", () => {
  const { card, hass } = setup({ reset_display: "absolute" });
  hass.locale.time_zone = "local";
  card.hass = hass;
  assert.match(html(card), /13:07/);
  hass.locale.time_format = "12";
  card.hass = hass;
  assert.match(html(card), /1:07 PM/);
});

test("theme selection follows dark mode and clears obsolete variables", () => {
  const { card, hass } = setup({ theme: "Frosted" });
  assert.equal(card.style.values["--ha-card-background"], "rgba(20,24,30,.6)");
  assert.equal(card.style.values["--primary-text-color"], "#fff");
  hass.themes.darkMode = false;
  card.hass = hass;
  assert.equal(card.style.values["--primary-text-color"], "#111");
  card.setConfig({ entity: "sensor.primary", theme: "Other" });
  assert.equal(card.style.values["--ha-card-background"], undefined);
  assert.equal(card.style.values["--primary-text-color"], "#abc");
  card.setConfig({ entity: "sensor.primary" });
  assert.equal(card.style.values["--primary-text-color"], undefined);
});

test("quota updates preserve the ha-card container for card_mod", () => {
  const { card, hass } = setup();
  const container = card._root.querySelector("ha-card");
  container.style.setProperty("background", "glass");
  hass.states["sensor.primary"].state = "25";
  card.hass = hass;
  assert.equal(card._root.querySelector("ha-card"), container);
  assert.equal(container.style.values.background, "glass");
  assert.match(html(card), /25%/);
});

test("quota updates restore the focused button and describe reset timing", () => {
  const { card, hass } = setup();
  let focused = false;
  const button = { dataset: { entity: "sensor.weekly" }, focus() { focused = true; }, addEventListener() {} };
  card._root.activeElement = { dataset: { entity: "sensor.weekly" } };
  card._content.querySelectorAll = () => [button];
  card.hass = hass;
  assert.equal(focused, true);
  assert.match(html(card), /aria-describedby="reset-0"/);
  assert.match(html(card), /aria-describedby="reset-1"/);
  assert.match(html(card), /id="reset-1"[^>]*>Next reset in 3d 02h 05m/);
});

test("countdown timer is started once and released on disconnect or mode change", () => {
  const { card, timers } = setup();
  card.connectedCallback();
  card.connectedCallback();
  assert.equal(timers.size, 1);
  assert.equal(timers.get(1).delay, 60000);
  card.disconnectedCallback();
  assert.equal(timers.size, 0);
  card.connectedCallback();
  card.setConfig({ entity: "sensor.primary", reset_display: "absolute" });
  assert.equal(timers.size, 0);
});

test("timer refreshes displayed countdown without replacing the card contents", () => {
  const { card, timers, setNow } = setup();
  const element = { dataset: { entity: "sensor.primary" }, textContent: "old" };
  card._content.querySelectorAll = () => [element];
  const originalHtml = html(card);
  setNow(NOW + 60000);
  timers.get(1).fn();
  assert.equal(element.textContent, "Next reset in 4h 06m");
  assert.equal(html(card), originalHtml);
});

test("non-finite quotas are unavailable and sensor labels are escaped", () => {
  const { card, hass } = setup();
  for (const value of ["Infinity", "-Infinity", Infinity, NaN]) {
    hass.states["sensor.primary"].state = value;
    card.hass = hass;
    assert.match(html(card), /Unavailable/);
    assert.doesNotMatch(html(card), /aria-valuenow=/);
  }
  hass.states["sensor.primary"].attributes.friendly_name = '<img src=x onerror="boom">';
  card.hass = hass;
  assert.doesNotMatch(html(card), /<img/);
  assert.match(html(card), /&lt;img/);
});

test("editor exposes native theme picker and reset display choices", () => {
  const { Card } = setup();
  const form = Card.getConfigForm();
  assert.ok(form.schema.find((field) => field.name === "theme").selector.theme);
  assert.deepEqual(Array.from(form.schema.find((field) => field.name === "reset_display").selector.select.options, (item) => item.value),
    ["countdown", "absolute", "hidden"]);
});

test("reject unsupported reset modes", () => {
  const { card } = setup();
  assert.throws(() => card.setConfig({ entity: "sensor.primary", reset_display: "nonsense" }), /reset_display/);
});
