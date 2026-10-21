import test from "node:test";
import assert from "node:assert/strict";
import { buildCampaign, approveCampaign, compareCampaign } from "../src/dingtalk/teaching.js";
import { DingTalkStore } from "../src/dingtalk/store.js";

const columns = { week:0, date:1, time:2, campus:3, course:4, className:5, teacher:6, room:7 };
const rows = [
  ["第7周", "2026-10-26", "08:00-09:40", "滨江校区", "超声诊断学1", "23级超声班", "甲老师", "A101"],
  ["第7周", "2026-10-27", "10:00-11:40", "滨江校区", "质量控制", "23级超声班", "乙老师", "B201"]
];
test("授课批次包含群通知，个人通知默认排除指定教师", () => {
  const campaign = buildCampaign({ rows, columns, weekLabel:"第7周", campus:"滨江校区", skipTeachers:["甲老师"] });
  assert.equal(campaign.lessons.length, 2);
  assert.equal(campaign.personalDrafts.length, 1);
  assert.equal(campaign.personalDrafts[0].teacher, "乙老师");
  assert.match(campaign.group.text, /甲老师/);
  assert.equal(approveCampaign(campaign, campaign.fingerprint).approvedFingerprint, campaign.fingerprint);
  assert.throws(() => approveCampaign(campaign, "stale"), /变化/);
});
test("调课变更撤销原批准并列出差异", () => {
  const prior = approveCampaign(buildCampaign({ rows, columns }), buildCampaign({ rows, columns }).fingerprint);
  const changed = rows.map((row) => [...row]); changed[1][7] = "B202";
  const next = compareCampaign(prior, buildCampaign({ rows:changed, columns }));
  assert.equal(next.changes.length, 1);
  assert.equal(next.changes[0].kind, "changed");
  assert.equal(next.approvedFingerprint, null);
});
test("班级或地点缺失时禁止批准", () => {
  const missing = rows.map((row) => [...row]); missing[0][7] = "";
  const campaign = buildCampaign({ rows:missing, columns });
  assert.throws(() => approveCampaign(campaign, campaign.fingerprint), /缺少班级或地点/);
});
test("会话上下文隔离，主动关联后双向可见", () => {
  const store = new DingTalkStore("/tmp/unused-dingtalk-store.json");
  const group = store.conversation("群A", "group");
  const privateChat = store.conversation("私聊B", "private");
  group.messages.push({ text:"群内课表" });
  privateChat.messages.push({ text:"私聊补充" });
  assert.deepEqual(store.context("群A").shared, []);
  privateChat.sharedWith = "群A";
  assert.equal(store.context("群A").shared[0].text, "私聊补充");
  assert.equal(store.context("私聊B").shared[0].text, "群内课表");
});
