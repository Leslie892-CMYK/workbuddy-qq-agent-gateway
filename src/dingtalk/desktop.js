import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const source = path.join(root, "modules/dingtalk-desktop/main.m");
const binary = path.join(root, "runtime/dingtalk-desktop-bridge");

async function ensureBinary(compile = true) {
  if (process.platform !== "darwin") throw new Error("桌面读取仅支持 macOS");
  if (!existsSync(binary) || statSync(binary).mtimeMs < statSync(source).mtimeMs) {
    if (!compile) throw new Error("桌面桥尚未编译");
    mkdirSync(path.dirname(binary), { recursive: true });
    await run("/usr/bin/clang", [source, "-framework", "AppKit", "-framework", "ApplicationServices", "-framework", "CoreFoundation", "-o", binary], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  }
}

export async function probeDingTalkDesktop() {
  await ensureBinary();
  const { stdout } = await run(binary, ["--probe"], { timeout: 10000 });
  return JSON.parse(stdout);
}

export async function readDingTalkWindow({ expectedName, compile = true } = {}) {
  if (!expectedName || expectedName.length > 150) throw new Error("请填写当前钉钉会话的准确名称");
  await ensureBinary(compile);
  let stdout;
  try { ({ stdout } = await run(binary, [], { timeout: 30000, maxBuffer: 16 * 1024 * 1024 })); }
  catch (error) {
    let detail = error.stdout || error.stderr || error.message;
    try { detail = JSON.parse(error.stderr).error || detail; } catch {}
    throw new Error(String(detail).slice(0, 1000));
  }
  const items = JSON.parse(stdout);
  if (!Array.isArray(items)) throw new Error(items.error || "桌面桥返回了无效数据");
  const visible = items.filter((item) => item.width > 0 && item.height > 0);
  const left = Math.min(...visible.map((item) => item.x));
  const top = Math.min(...visible.map((item) => item.y));
  const right = Math.max(...visible.map((item) => item.x + item.width));
  const bottom = Math.max(...visible.map((item) => item.y + item.height));
  const paneLeft = left + (right - left) * 0.23;
  const header = visible.filter((item) => item.x > paneLeft && item.y < top + 140 && item.role === "AXStaticText");
  if (!header.some((item) => item.value.trim() === expectedName.trim())) {
    throw new Error("当前钉钉聊天标题与填写名称不一致，已停止读取");
  }
  const messages = visible.filter((item) => item.x > paneLeft && item.y > top + 140
    && item.y < bottom - 150 && ["AXStaticText", "AXTextField"].includes(item.role)
    && item.value.trim() && item.value.trim() !== expectedName.trim())
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((item) => ({ text: item.value.trim(), fingerprint: createHash("sha256")
      .update(`${expectedName}|${Math.round(item.y)}|${item.value.trim()}`).digest("hex"),
      capturedAt: new Date().toISOString(), source: "dingtalk-accessibility" }));
  return { conversationId: expectedName.trim(), messages, visibleCount: messages.length };
}
