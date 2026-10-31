import type { LoginInput } from "../shared/contracts";

export function parseLoginInput(value: unknown): LoginInput {
  const record = asRecord(value, "登录参数");
  return {
    serverUrl: parseRequiredString(record.serverUrl, "NAS 地址"),
    username: parseRequiredString(record.username, "账号"),
    password: parsePasswordString(record.password),
    remember: typeof record.remember === "boolean" ? record.remember : false,
  };
}

function parseRequiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空`);
  return value.trim();
}

function parsePasswordString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("密码不能为空");
  return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}格式无效`);
  return value as Record<string, unknown>;
}
