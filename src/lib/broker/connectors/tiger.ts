import "server-only";

import { constants, createPrivateKey, createSign, type KeyObject } from "node:crypto";
import { readBrokerEnv, tigerConfigured } from "@/lib/broker/env";
import type {
  BrokerAccountSnapshot,
  BrokerConnector,
  BrokerPositionSnapshot,
} from "@/lib/broker/types";

function nowIso() {
  return new Date().toISOString();
}

function toNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 2
): Promise<Response> {
  let lastError: unknown = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const res = await fetch(url, { ...init, cache: "no-store" });
      if (res.status >= 500 && i < attempts - 1) {
        continue;
      }
      return res;
    } catch (e) {
      lastError = e;
      if (i === attempts - 1) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Tiger request failed");
}

function pickFirst(obj: any, keys: string[]): unknown {
  for (const key of keys) {
    if (obj && obj[key] != null) return obj[key];
  }
  return null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function shapeSummary(json: unknown) {
  const root = isObject(json) ? json : {};
  const data = (root as any).data;
  const result = (root as any).result;
  const results = (root as any).results;
  return {
    root_type: Array.isArray(json) ? "array" : typeof json,
    root_keys: Object.keys(root).slice(0, 40),
    data_type: Array.isArray(data) ? "array" : typeof data,
    data_keys: isObject(data) ? Object.keys(data).slice(0, 40) : [],
    result_type: Array.isArray(result) ? "array" : typeof result,
    result_keys: isObject(result) ? Object.keys(result).slice(0, 40) : [],
    results_type: Array.isArray(results) ? "array" : typeof results,
    results_keys: isObject(results) ? Object.keys(results).slice(0, 40) : [],
    code: (root as any).code ?? null,
    status: (root as any).status ?? null,
    message: (root as any).message ?? (root as any).msg ?? null,
  };
}

function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isObject(cur)) return undefined;
    cur = (cur as any)[part];
  }
  return cur;
}

function firstArrayByPaths(obj: unknown, paths: string[]) {
  for (const path of paths) {
    const v = getByPath(obj, path);
    if (Array.isArray(v)) return { path, value: v as any[] };
  }
  return { path: null as string | null, value: [] as any[] };
}

function firstObjectByPaths(obj: unknown, paths: string[]) {
  for (const path of paths) {
    const v = getByPath(obj, path);
    if (isObject(v)) return { path, value: v as Record<string, unknown> };
  }
  return { path: null as string | null, value: null as Record<string, unknown> | null };
}

function deepFindByKeys(obj: unknown, keys: string[], maxDepth = 6): unknown {
  const wanted = new Set(keys.map((k) => k.toLowerCase()));
  const queue: Array<{ value: unknown; depth: number }> = [{ value: obj, depth: 0 }];
  const seen = new Set<unknown>();
  while (queue.length > 0) {
    const { value, depth } = queue.shift()!;
    if (!value || depth > maxDepth || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const v of value.slice(0, 50)) queue.push({ value: v, depth: depth + 1 });
      continue;
    }
    if (!isObject(value)) continue;
    for (const [k, v] of Object.entries(value)) {
      if (wanted.has(k.toLowerCase()) && v != null) return v;
    }
    for (const v of Object.values(value)) queue.push({ value: v, depth: depth + 1 });
  }
  return null;
}

function buildTigerBizContent(opts: { accountId: string }) {
  const accountId = String(opts.accountId ?? "").trim();
  return {
    accountId,
    account_id: accountId,
    account: accountId,
  };
}

function formatGatewayTimestamp(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours()
  )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const v = String(raw ?? "").trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function normalizePrivateKey(raw: string): string {
  let trimmed = String(raw ?? "").trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  if (!trimmed) return "";
  return trimmed.replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
}

function canonicalizeParamsForSign(input: Record<string, unknown>) {
  const entries = Object.entries(input)
    .filter(([key, value]) => key !== "sign" && value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return {
    ordered_keys: entries.map(([k]) => k),
    canonical: entries.map(([k, v]) => `${k}=${v}`).join("&"),
  };
}

function wrapPem(body: string, kind: "RSA PRIVATE KEY" | "PRIVATE KEY") {
  const clean = body.replace(/\s+/g, "");
  const lines = clean.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${kind}-----\n${lines.join("\n")}\n-----END ${kind}-----`;
}

function keyCandidates(raw: string): string[] {
  const normalized = normalizePrivateKey(raw);
  if (!normalized) return [];
  const hasPemMarkers = /-----BEGIN [A-Z ]+-----/.test(normalized);
  if (hasPemMarkers) {
    const normalizedPem = normalized
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+\n/g, "\n")
      .trim();
    return [normalizedPem];
  }
  const body = normalized.replace(/\s+/g, "");
  if (!body) return [];
  return [wrapPem(body, "RSA PRIVATE KEY"), wrapPem(body, "PRIVATE KEY")];
}

function parseTigerPrivateKey(raw: string): { key: KeyObject; format: "PKCS#1" | "PKCS#8" | "UNKNOWN" } {
  const candidates = keyCandidates(raw);
  if (candidates.length === 0) {
    throw new Error("Tiger private key missing or empty");
  }
  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      try {
        return {
          key: createPrivateKey({ key: candidate, format: "pem", type: "pkcs1" }),
          format: "PKCS#1",
        };
      } catch {
        return {
          key: createPrivateKey({ key: candidate, format: "pem", type: "pkcs8" }),
          format: "PKCS#8",
        };
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push(message);
    }
  }
  const reason = errors[errors.length - 1] ?? "Unknown key parsing error";
  throw new Error(
    `Tiger private key parse failed (supported: PKCS#1/PKCS#8 PEM or base64 body). ${reason}`
  );
}

export class TigerReadOnlyConnector implements BrokerConnector {
  provider = "tiger" as const;
  mode = "read_only_live" as const;
  private readonly debug: Record<string, unknown> = {
    provider: "tiger",
    mode: "read_only_live",
  };

  private endpointUrl(pathOrUrl: string) {
    const env = readBrokerEnv();
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    const base = env.tiger.base_url.replace(/\/+$/, "");
    const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
    return `${base}${path}`;
  }

  private signedInit(opts: {
    pathOrUrl: string;
    methodName: string;
    bizContent?: Record<string, unknown>;
  }) {
    const env = readBrokerEnv();
    const url = this.endpointUrl(opts.pathOrUrl);
    const gatewayTimestamp = formatGatewayTimestamp();
    const envelope: Record<string, unknown> = {
      tiger_id: String(env.tiger.client_id ?? "").trim(),
      method: String(opts.methodName ?? "").trim(),
      charset: String(env.tiger.charset ?? "UTF-8").trim() || "UTF-8",
      sign_type: String(env.tiger.sign_type ?? "RSA").trim() || "RSA",
      version: String(env.tiger.version ?? "1.0").trim() || "1.0",
      timestamp: gatewayTimestamp,
      biz_content: JSON.stringify(isObject(opts.bizContent) ? opts.bizContent : {}),
    };
    const canonicalParams = canonicalizeParamsForSign(envelope);
    const canonical = canonicalParams.canonical;
    const privateKey = parseTigerPrivateKey(env.tiger.private_key);
    const signType = String(envelope.sign_type ?? "RSA").toUpperCase();
    const signAlgorithm = signType === "RSA2" ? "RSA-SHA256" : "RSA-SHA1";
    const signer = createSign(signAlgorithm);
    signer.update(canonical);
    signer.end();
    let signature = "";
    try {
      signature = signer
        .sign({
          key: privateKey.key,
          padding: constants.RSA_PKCS1_PADDING,
        })
        .toString("base64");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Tiger request signing failed: ${message}`);
    }
    envelope.sign = signature;

    const bodyText = JSON.stringify(envelope);
    const headers: Record<string, string> = {
      "content-type": "application/json; charset=UTF-8",
      "x-tiger-client-id": env.tiger.client_id,
      "x-tiger-signature-algorithm": signAlgorithm,
      // Keep header signature for compatibility; Tiger gateway also requires body `sign`.
      "x-tiger-signature": signature,
    };
    // Optional compatibility fallback: include bearer token if supplied.
    if (env.tiger.access_token) {
      headers.authorization = `Bearer ${env.tiger.access_token}`;
    }
    return {
      url,
      init: {
        method: "POST",
        headers,
        ...(bodyText ? { body: bodyText } : {}),
      } as RequestInit,
      signedMeta: {
        envelope_keys: Object.keys(envelope),
        canonical_param_order: canonicalParams.ordered_keys,
        canonical_keys_signed: canonicalParams.ordered_keys,
        charset_value: String(envelope.charset ?? ""),
        sign_type_value: String(envelope.sign_type ?? ""),
        version_value: String(envelope.version ?? ""),
        timestamp_value_used: String(envelope.timestamp ?? ""),
        timestamp_format_used: "YYYY-MM-DD HH:mm:ss (UTC)",
        method_used: String(envelope.method ?? ""),
        biz_content_present: Boolean(envelope.biz_content),
        biz_content_keys: isObject(opts.bizContent) ? Object.keys(opts.bizContent) : [],
        biz_content_length: String(envelope.biz_content ?? "").length,
        timestamp_present: Boolean(envelope.timestamp),
        sign_present: Boolean(envelope.sign),
        private_key_format_detected: privateKey.format,
        sign_algorithm_used: signAlgorithm,
        sign_padding_used: "RSA_PKCS1_PADDING",
        signed_param_count: canonicalParams.canonical ? canonicalParams.canonical.split("&").length : 0,
      },
    };
  }

  private isUnsupportedMethodError(json: unknown) {
    const root = isObject(json) ? (json as any) : null;
    const code = root?.code != null ? String(root.code) : "";
    const message = String(root?.message ?? root?.msg ?? "");
    return code === "1000" && /method does not support/i.test(message);
  }

  private extractGatewayError(json: unknown): string | null {
    const root = isObject(json) ? (json as any) : null;
    if (!root) return null;
    const code = root.code != null ? String(root.code) : "";
    const message = String(root.message ?? root.msg ?? "").trim();
    if (!message && !code) return null;
    if (!code || code === "0" || /success/i.test(message)) return null;
    return `${code}:${message || "gateway error"}`;
  }

  private async executeWithMethodFallback(opts: {
    pathOrUrl: string;
    bizContent: Record<string, unknown>;
    methods: string[];
    debugPrefix: "account" | "positions";
  }) {
    const attempts: Array<{
      method: string;
      status: number;
      ok: boolean;
      code: string | null;
      message: string | null;
      envelope_keys: string[];
      biz_content_keys: string[];
      charset_value: string;
      sign_type_value: string;
      version_value: string;
      timestamp_format_used: string;
      sign_present: boolean;
    }> = [];

    for (const methodName of opts.methods) {
      const request = this.signedInit({
        pathOrUrl: opts.pathOrUrl,
        methodName,
        bizContent: opts.bizContent,
      });
      const res = await fetchWithRetry(request.url, request.init);
      const json = await res.json().catch(() => null);
      const root = isObject(json) ? (json as any) : {};
      const code = root?.code != null ? String(root.code) : null;
      const message = root?.message != null ? String(root.message) : root?.msg != null ? String(root.msg) : null;
      attempts.push({
        method: methodName,
        status: res.status,
        ok: res.ok,
        code,
        message,
        envelope_keys: (request as any)?.signedMeta?.envelope_keys ?? [],
        biz_content_keys: (request as any)?.signedMeta?.biz_content_keys ?? [],
        charset_value: String((request as any)?.signedMeta?.charset_value ?? ""),
        sign_type_value: String((request as any)?.signedMeta?.sign_type_value ?? ""),
        version_value: String((request as any)?.signedMeta?.version_value ?? ""),
        timestamp_format_used: String((request as any)?.signedMeta?.timestamp_format_used ?? ""),
        sign_present: Boolean((request as any)?.signedMeta?.sign_present),
      });

      if (!res.ok) {
        // Continue trying alternate methods for gateway method errors only.
        if (this.isUnsupportedMethodError(json)) continue;
        throw new Error(`Tiger ${opts.debugPrefix} request failed (${res.status})`);
      }

      if (this.isUnsupportedMethodError(json)) {
        continue;
      }

      const gatewayError = this.extractGatewayError(json);
      if (gatewayError) {
        throw new Error(`Tiger gateway error: ${gatewayError}`);
      }

      (this.debug as any)[`${opts.debugPrefix}_method_attempts`] = attempts;
      (this.debug as any)[`${opts.debugPrefix}_method_selected`] = methodName;
      return { json, request, res, methodName, attempts };
    }

    (this.debug as any)[`${opts.debugPrefix}_method_attempts`] = attempts;
    throw new Error(
      `Tiger gateway method unsupported (${opts.debugPrefix}): ${opts.methods.join(", ")}`
    );
  }

  isConfigured(): boolean {
    return tigerConfigured(readBrokerEnv());
  }

  getReadOnlyDebug(): Record<string, unknown> | null {
    return { ...this.debug };
  }

  async fetchAccountReadOnly(): Promise<BrokerAccountSnapshot | null> {
    const env = readBrokerEnv();
    const configured = tigerConfigured(env);
    if (!configured) return null;

    // Phase 1 safety boundary:
    // Read-only broker sync only. No execution and no strategy influence.
    const accountBiz = buildTigerBizContent({
      accountId: env.tiger.account_id,
    });
    const accountMethods = uniqueStrings([
      env.tiger.account_method,
      "assets",
      "get_assets",
      "accounts",
      "get_account",
    ]);
    const accountCall = await this.executeWithMethodFallback({
      pathOrUrl: env.tiger.account_endpoint,
      bizContent: accountBiz,
      methods: accountMethods,
      debugPrefix: "account",
    });
    const request = accountCall.request;
    this.debug.account_request = {
      endpoint: request.url,
      method: "POST",
      envelope_keys: (request as any)?.signedMeta?.envelope_keys ?? [],
      account_id_present: Boolean(env.tiger.account_id),
      tiger_id_present: Boolean(env.tiger.client_id),
      tiger_id_source: "TIGER_CLIENT_ID",
      account_source: "TIGER_ACCOUNT_ID",
      charset_value: String((request as any)?.signedMeta?.charset_value ?? ""),
      sign_type_value: String((request as any)?.signedMeta?.sign_type_value ?? ""),
      version_value: String((request as any)?.signedMeta?.version_value ?? ""),
      timestamp_format_used: String((request as any)?.signedMeta?.timestamp_format_used ?? ""),
      timestamp_value_used: String((request as any)?.signedMeta?.timestamp_value_used ?? ""),
      method_used: String((this.debug as any)?.account_method_selected ?? (request as any)?.signedMeta?.method_used ?? ""),
      method_candidates: accountMethods,
      biz_content_present: Boolean((request as any)?.signedMeta?.biz_content_present),
      biz_content_keys: (request as any)?.signedMeta?.biz_content_keys ?? [],
      biz_content_length: Number((request as any)?.signedMeta?.biz_content_length ?? 0),
      timestamp_present: Boolean((request as any)?.signedMeta?.timestamp_present),
      sign_present: Boolean((request as any)?.signedMeta?.sign_present),
      canonical_param_order: (request as any)?.signedMeta?.canonical_param_order ?? [],
      canonical_keys_signed: (request as any)?.signedMeta?.canonical_keys_signed ?? [],
      private_key_format_detected: String((request as any)?.signedMeta?.private_key_format_detected ?? "UNKNOWN"),
      sign_algorithm_used: String((request as any)?.signedMeta?.sign_algorithm_used ?? ""),
      sign_padding_used: String((request as any)?.signedMeta?.sign_padding_used ?? ""),
      signed_param_count: Number((request as any)?.signedMeta?.signed_param_count ?? 0),
      base_url: env.tiger.base_url,
    };
    const res = accountCall.res;
    this.debug.account_http = {
      ok: res.ok,
      status: res.status,
      status_text: res.statusText,
    };
    const json = accountCall.json;
    const rootObj = isObject(json) ? json : null;
    const accountObj = firstObjectByPaths(json, [
      "data.account",
      "data.summary",
      "data.assets",
      "result.account",
      "result.summary",
      "results.account",
      "account",
      "data",
      "result",
      "results",
    ]);

    const fromObj = accountObj.value ?? (rootObj as any);
    const asOf = String(
      pickFirst(fromObj, ["as_of", "asOf", "updated_at", "timestamp", "time"]) ??
        deepFindByKeys(json, ["as_of", "updated_at", "timestamp", "time"]) ??
        nowIso()
    );
    const currency = String(
      pickFirst(fromObj, ["currency", "base_currency", "baseCurrency"]) ??
        deepFindByKeys(json, ["currency", "base_currency"]) ??
        "USD"
    );
    const cash = toNum(
      pickFirst(fromObj, [
        "cash_available",
        "cash",
        "available_funds",
        "available_cash",
        "cash_balance",
        "availableBalance",
      ]) ??
        deepFindByKeys(json, [
          "cash_available",
          "available_funds",
          "available_cash",
          "cash_balance",
          "cash",
        ])
    );
    const equity = toNum(
      pickFirst(fromObj, ["equity", "net_liquidation", "net_asset_value", "total_assets"]) ??
        deepFindByKeys(json, ["equity", "net_liquidation", "net_asset_value", "total_assets"])
    );
    const buyingPower = toNum(
      pickFirst(fromObj, [
        "buying_power",
        "buyingPower",
        "max_buying_power",
        "available_buying_power",
      ]) ??
        deepFindByKeys(json, [
          "buying_power",
          "buyingPower",
          "max_buying_power",
          "available_buying_power",
        ])
    );

    this.debug.account_parse = {
      selected_path: accountObj.path,
      shape: shapeSummary(json),
      mapped: {
        currency,
        cash_available: cash,
        equity,
        buying_power: buyingPower,
      },
    };

    return {
      account_id: env.tiger.account_id || "tiger_account",
      currency,
      cash_available: cash,
      equity,
      buying_power: buyingPower,
      as_of: asOf,
      source: "broker_api",
    };
  }

  async fetchPositionsReadOnly(): Promise<BrokerPositionSnapshot[]> {
    const env = readBrokerEnv();
    const configured = tigerConfigured(env);
    if (!configured) return [];

    const positionsBiz = buildTigerBizContent({
      accountId: env.tiger.account_id,
    });
    const positionsMethods = uniqueStrings([
      env.tiger.positions_method,
      "positions",
      "get_positions",
      "position_list",
    ]);
    const positionsCall = await this.executeWithMethodFallback({
      pathOrUrl: env.tiger.positions_endpoint,
      bizContent: positionsBiz,
      methods: positionsMethods,
      debugPrefix: "positions",
    });
    const request = positionsCall.request;
    this.debug.positions_request = {
      endpoint: request.url,
      method: "POST",
      envelope_keys: (request as any)?.signedMeta?.envelope_keys ?? [],
      account_id_present: Boolean(env.tiger.account_id),
      tiger_id_present: Boolean(env.tiger.client_id),
      tiger_id_source: "TIGER_CLIENT_ID",
      account_source: "TIGER_ACCOUNT_ID",
      charset_value: String((request as any)?.signedMeta?.charset_value ?? ""),
      sign_type_value: String((request as any)?.signedMeta?.sign_type_value ?? ""),
      version_value: String((request as any)?.signedMeta?.version_value ?? ""),
      timestamp_format_used: String((request as any)?.signedMeta?.timestamp_format_used ?? ""),
      timestamp_value_used: String((request as any)?.signedMeta?.timestamp_value_used ?? ""),
      method_used: String((this.debug as any)?.positions_method_selected ?? (request as any)?.signedMeta?.method_used ?? ""),
      method_candidates: positionsMethods,
      biz_content_present: Boolean((request as any)?.signedMeta?.biz_content_present),
      biz_content_keys: (request as any)?.signedMeta?.biz_content_keys ?? [],
      biz_content_length: Number((request as any)?.signedMeta?.biz_content_length ?? 0),
      timestamp_present: Boolean((request as any)?.signedMeta?.timestamp_present),
      sign_present: Boolean((request as any)?.signedMeta?.sign_present),
      canonical_param_order: (request as any)?.signedMeta?.canonical_param_order ?? [],
      canonical_keys_signed: (request as any)?.signedMeta?.canonical_keys_signed ?? [],
      private_key_format_detected: String((request as any)?.signedMeta?.private_key_format_detected ?? "UNKNOWN"),
      sign_algorithm_used: String((request as any)?.signedMeta?.sign_algorithm_used ?? ""),
      sign_padding_used: String((request as any)?.signedMeta?.sign_padding_used ?? ""),
      signed_param_count: Number((request as any)?.signedMeta?.signed_param_count ?? 0),
      base_url: env.tiger.base_url,
    };
    const res = positionsCall.res;
    this.debug.positions_http = {
      ok: res.ok,
      status: res.status,
      status_text: res.statusText,
    };
    const json = positionsCall.json;
    const positionsList = firstArrayByPaths(json, [
      "data.positions",
      "data.items",
      "data.holdings",
      "data.rows",
      "result.positions",
      "result.items",
      "results.positions",
      "results.items",
      "positions",
      "data",
      "result",
      "results",
    ]);
    const list = positionsList.value;
    this.debug.positions_parse = {
      selected_path: positionsList.path,
      shape: shapeSummary(json),
      candidate_count: Array.isArray(list) ? list.length : 0,
    };
    if (!Array.isArray(list)) return [];
    const asOf = nowIso();
    const normalized = list
      .map((row: any) => {
        const symbol = String(
          pickFirst(row, ["symbol", "ticker", "contract", "instrument_id", "secuCode"]) ?? ""
        )
          .trim()
          .toUpperCase();
        const quantity = toNum(
          pickFirst(row, ["quantity", "qty", "position", "shares", "positionQty", "holdQty"])
        ) ?? 0;
        const average_cost = toNum(
          pickFirst(row, ["average_cost", "avg_cost", "cost_price", "averagePrice", "costPrice"])
        );
        const market_price = toNum(
          pickFirst(row, ["market_price", "last_price", "price", "latestPrice", "marketPrice"])
        );
        const market_value = toNum(pickFirst(row, ["market_value", "value"]));
        const unrealized_pnl = toNum(
          pickFirst(row, ["unrealized_pnl", "unrealized", "floating_pnl", "unrealizedPnl"])
        );
        return {
          symbol,
          quantity,
          average_cost,
          market_price,
          market_value,
          unrealized_pnl,
          as_of: asOf,
          source: "broker_api" as const,
        };
      })
      .filter((row) => row.symbol && row.quantity !== 0);
    this.debug.positions_parse = {
      ...(this.debug.positions_parse as any),
      normalized_count: normalized.length,
      sample_symbols: normalized.slice(0, 5).map((r) => r.symbol),
    };
    return normalized;
  }

  async placeOrder(_payload: unknown): Promise<never> {
    throw new Error(
      "Execution disabled: Tiger connector is read-only in Phase 1."
    );
  }
}
