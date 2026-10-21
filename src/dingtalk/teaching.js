import { createHash, randomUUID } from "node:crypto";

const clean = (value) => String(value ?? "").trim();
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function normalizeLesson(raw, columns) {
  const get = (key) => clean(raw[columns[key]]);
  const lesson = {
    week: get("week"), date: get("date"), time: get("time"), campus: get("campus"),
    course: get("course"), className: get("className"), teacher: get("teacher"),
    room: get("room"), location: get("location"), note: get("note")
  };
  if (!lesson.teacher || !lesson.course || !lesson.date || !lesson.time) {
    throw new Error("每行至少需要授课教师、课程、日期和时间");
  }
  return lesson;
}

export function buildCampaign({ rows, columns, weekLabel, campus, skipTeachers = [], sourceName = "" }) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 2000) throw new Error("授课数据须为 1–2000 行");
  if (!columns || typeof columns !== "object") throw new Error("请选择表格列");
  const lessons = rows.filter((row) => Object.values(row || {}).some((value) => clean(value)))
    .map((row) => normalizeLesson(row, columns))
    .filter((row) => !campus || row.campus === campus)
    .filter((row) => !weekLabel || row.week === weekLabel);
  if (!lessons.length) throw new Error("筛选后没有授课记录，请核对周次和校区");
  const ordered = lessons.sort((a, b) => `${a.date}|${a.time}|${a.teacher}`.localeCompare(`${b.date}|${b.time}|${b.teacher}`, "zh-CN"));
  const skipped = new Set(skipTeachers.map(clean).filter(Boolean));
  const targetWeek = clean(weekLabel) || [...new Set(ordered.map((row) => row.week).filter(Boolean))].join("、");
  const targetCampus = clean(campus) || [...new Set(ordered.map((row) => row.campus).filter(Boolean))].join("、");
  const title = `${targetWeek || "下周"}｜${targetCampus || "授课"}通知`;
  const format = (row) => `${row.date} ${row.time}｜${row.course}｜${row.className || "班级待核"}｜${row.room || row.location || "地点待核"}`;
  const groupDraft = `各位老师好，${title}：\n${ordered.map((row) => `${format(row)}｜${row.teacher}`).join("\n")}\n请各位老师核对时间、地点和授课安排。如有调课，请及时告知。`;
  const byTeacher = new Map();
  for (const row of ordered) {
    if (!byTeacher.has(row.teacher)) byTeacher.set(row.teacher, []);
    byTeacher.get(row.teacher).push(row);
  }
  const personalDrafts = [...byTeacher].filter(([teacher]) => !skipped.has(teacher))
    .map(([teacher, items]) => ({ teacher, text: `${teacher}老师您好，提醒您${targetWeek || "下周"}的授课安排：\n${items.map(format).join("\n")}\n请您核对。如需调整，请及时告知。`, status: "draft", receipt: null }));
  const fingerprint = hash({ ordered, groupDraft, personalDrafts, sourceName });
  return {
    id: randomUUID(), createdAt: new Date().toISOString(), sourceName: clean(sourceName),
    title, weekLabel: targetWeek, campus: targetCampus, lessons: ordered,
    group: { text: groupDraft, status: "draft", receipt: null },
    personalDrafts, excludedTeachers: [...skipped], fingerprint, approvedFingerprint: null,
    changes: [], readChecks: []
  };
}

export function approveCampaign(campaign, fingerprint) {
  if (campaign.fingerprint !== fingerprint) throw new Error("预览内容已变化，请重新审阅");
  if (campaign.lessons.some((row) => !row.className || (!row.room && !row.location))) {
    throw new Error("授课记录缺少班级或地点，请补全后再批准");
  }
  return { ...campaign, approvedFingerprint: fingerprint, approvedAt: new Date().toISOString() };
}

export function compareCampaign(previous, next) {
  const key = (row) => `${row.teacher}|${row.course}|${row.className}`;
  const before = new Map(previous.lessons.map((row) => [key(row), row]));
  const after = new Map(next.lessons.map((row) => [key(row), row]));
  const changes = [];
  for (const [id, row] of before) {
    if (!after.has(id)) changes.push({ kind: "removed", before: row });
    else if (hash(row) !== hash(after.get(id))) changes.push({ kind: "changed", before: row, after: after.get(id) });
  }
  for (const [id, row] of after) if (!before.has(id)) changes.push({ kind: "added", after: row });
  return { ...next, id: previous.id, createdAt: previous.createdAt, changes,
    approvedFingerprint: null, group: { ...next.group, status: "draft" },
    personalDrafts: next.personalDrafts.map((draft) => ({ ...draft, status: "draft" })) };
}
