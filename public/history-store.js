export function readHistory(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function archiveSession(storage, key, entry) {
  const history = readHistory(storage, key).filter((item) => item.sessionId !== entry.sessionId);
  history.push(entry);
  history.sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)));
  const result = history.slice(0, 100);
  storage.setItem(key, JSON.stringify(result));
  return result;
}

export function groupHistoryByDate(history) {
  return history.reduce((groups, entry) => {
    const date = entry.completedDate || String(entry.completedAt || "").slice(0, 10) || "日期未知";
    (groups[date] ||= []).push(entry);
    return groups;
  }, {});
}
