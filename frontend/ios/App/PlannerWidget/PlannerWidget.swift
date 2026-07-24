import WidgetKit
import SwiftUI

// MARK: - API model

struct APISlot: Decodable {
    let name: String
    let subject: String
    let task: String
    let completed: Bool
    let minutes: Int?
}

struct APIDay: Decodable {
    let date: String
    let day: String
    let slots: [APISlot]
}

// MARK: - Palette (mirrors frontend subjectColors.ts)

extension Color {
    init(hex: UInt32) {
        self.init(
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255
        )
    }
}

let appBackground = Color(hex: 0x060808)
let primaryAccent = Color(hex: 0xADC6FF)
let catchUpAccent = Color(hex: 0xFFB4AB)

func subjectColor(_ subject: String) -> Color {
    switch subject {
    case "Western Philosophy", "Polity": return Color(hex: 0xADC6FF)
    case "Indian Philosophy", "History": return Color(hex: 0xC2C1FF)
    case "Ethics", "Economy":            return Color(hex: 0x68D3FF)
    case "Art & Culture":                return Color(hex: 0xFFB4AB)
    default:                             return Color(hex: 0xADC6FF)
    }
}

// MARK: - Entry

enum DayMark {
    case none, missed, partial, full, future
}

struct TaskRow: Identifiable {
    let id: String
    let subject: String
    let title: String
    let pages: String?
    let completed: Bool
}

struct PlannerEntry: TimelineEntry {
    let date: Date
    let dayLabel: String      // "WED · JUL 22"
    let tasks: [TaskRow]
    let doneToday: Int
    let totalToday: Int
    let catchUp: Int
    let week: [DayMark]       // 7 entries, Monday first
    let todayIndex: Int
    var isError: Bool = false // fetch failed and no cache — not a rest day

    static let sample = PlannerEntry(
        date: .now, dayLabel: "WED · JUL 22",
        tasks: [
            TaskRow(id: "1", subject: "Western Philosophy", title: "Immanuel Kant", pages: "330–347", completed: true),
            TaskRow(id: "2", subject: "Ethics", title: "Moral Thinkers & Philosophers", pages: "108–117", completed: false),
        ],
        doneToday: 1, totalToday: 2, catchUp: 3,
        week: [.full, .partial, .none, .missed, .none, .future, .future], todayIndex: 2
    )

    static let unavailable = PlannerEntry(
        date: .now, dayLabel: "TODAY", tasks: [],
        doneToday: 0, totalToday: 0, catchUp: 0,
        week: Array(repeating: .none, count: 7), todayIndex: 0,
        isError: true
    )
}

// MARK: - Plan digestion

private func localDateString(_ date: Date) -> String {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    return f.string(from: date)
}

/// "2. Greek System (...) (pp.87-104), 3. ..." → first reading title + joined page ranges
private func digest(task: String) -> (title: String, pages: String?) {
    let pageRegex = try? NSRegularExpression(pattern: "\\(pp\\.(\\d+)\\s*-\\s*(\\d+)\\)")
    var ranges: [String] = []
    if let re = pageRegex {
        let ns = task as NSString
        re.enumerateMatches(in: task, range: NSRange(location: 0, length: ns.length)) { m, _, _ in
            guard let m = m else { return }
            let a = ns.substring(with: m.range(at: 1)), b = ns.substring(with: m.range(at: 2))
            ranges.append(a == b ? a : "\(a)–\(b)")
        }
    }
    var title = task
    if let re = pageRegex {
        title = re.stringByReplacingMatches(in: title, range: NSRange(location: 0, length: (title as NSString).length), withTemplate: "")
    }
    title = title.components(separatedBy: ",").first ?? title
    if let r = title.range(of: "^\\s*\\d+[.:]\\s*", options: .regularExpression) {
        title.removeSubrange(r)
    }
    title = title.trimmingCharacters(in: .whitespacesAndNewlines)
    return (title, ranges.isEmpty ? nil : ranges.joined(separator: ", "))
}

extension PlannerEntry {
    static func build(from days: [APIDay]) -> PlannerEntry {
        let now = Date()
        let todayStr = localDateString(now)

        let today = days.first { $0.date == todayStr }
        let slots = today?.slots ?? []
        let done = slots.filter { $0.completed }.count

        let rows: [TaskRow] = slots.map { s in
            let d = digest(task: s.task)
            return TaskRow(id: s.name, subject: s.subject, title: d.title, pages: d.pages, completed: s.completed)
        }

        var catchUp = 0
        for d in days where d.date < todayStr {
            catchUp += d.slots.filter { !$0.completed && $0.task != "Revision" }.count
        }

        var cal = Calendar(identifier: .gregorian)
        cal.firstWeekday = 2
        let weekday = (cal.component(.weekday, from: now) + 5) % 7 // Mon = 0
        let monday = cal.date(byAdding: .day, value: -weekday, to: cal.startOfDay(for: now))!
        let byDate = Dictionary(uniqueKeysWithValues: days.map { ($0.date, $0) })

        var week: [DayMark] = []
        for i in 0..<7 {
            let d = cal.date(byAdding: .day, value: i, to: monday)!
            let ds = localDateString(d)
            guard let day = byDate[ds], !day.slots.isEmpty else { week.append(.none); continue }
            if ds > todayStr { week.append(.future); continue }
            let c = day.slots.filter { $0.completed }.count
            if c == day.slots.count { week.append(.full) }
            else if c > 0 { week.append(.partial) }
            else { week.append(ds == todayStr ? .none : .missed) }
        }

        let df = DateFormatter()
        df.dateFormat = "EEE · MMM d"
        return PlannerEntry(
            date: now,
            dayLabel: df.string(from: now).uppercased(),
            tasks: rows,
            doneToday: done,
            totalToday: slots.count,
            catchUp: catchUp,
            week: week,
            todayIndex: weekday
        )
    }
}

// MARK: - Provider

struct Provider: TimelineProvider {
    private static let cacheKey = "planCache"

    func placeholder(in context: Context) -> PlannerEntry { .sample }

    func getSnapshot(in context: Context, completion: @escaping (PlannerEntry) -> Void) {
        if context.isPreview { completion(.sample); return }
        fetch { entry, _ in completion(entry) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PlannerEntry>) -> Void) {
        fetch { entry, fresh in
            // Fresh data: refresh in 30 min. Failure (Render cold start):
            // retry in 5 — the failed request itself wakes the backend.
            let minutes = fresh ? 30 : 5
            let next = Calendar.current.date(byAdding: .minute, value: minutes, to: Date())!
            completion(Timeline(entries: [entry], policy: .after(next)))
        }
    }

    private func fetch(completion: @escaping (PlannerEntry, Bool) -> Void) {
        // Primary source: the plan the app itself fetched, handed over through
        // the app group. Instant, offline-proof, immune to backend cold starts.
        if let shared = UserDefaults(suiteName: "group.com.kr1da.planner")?.string(forKey: "planJSON"),
           let data = shared.data(using: .utf8),
           let days = try? JSONDecoder().decode([APIDay].self, from: data) {
            completion(.build(from: days), true)
            return
        }

        // Fallback: fetch directly (first run before the app has ever opened)
        guard let url = URL(string: "https://planner-936q.onrender.com/api/plan") else {
            completion(.unavailable, false); return
        }
        var req = URLRequest(url: url)
        req.timeoutInterval = 45
        URLSession.shared.dataTask(with: req) { data, _, _ in
            if let data, let days = try? JSONDecoder().decode([APIDay].self, from: data) {
                UserDefaults.standard.set(data, forKey: Self.cacheKey)
                completion(.build(from: days), true)
            } else if let cached = UserDefaults.standard.data(forKey: Self.cacheKey),
                      let days = try? JSONDecoder().decode([APIDay].self, from: cached) {
                completion(.build(from: days), false)
            } else {
                completion(.unavailable, false)
            }
        }.resume()
    }
}

// MARK: - Building blocks

struct HeaderRow: View {
    let entry: PlannerEntry
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(entry.dayLabel)
                .font(.system(size: 9, weight: .semibold))
                .tracking(1.1)
                .foregroundStyle(.white.opacity(0.45))
            Spacer()
            if entry.totalToday > 0 {
                Text("\(entry.doneToday)/\(entry.totalToday)")
                    .font(.system(size: 11, weight: .semibold).monospacedDigit())
                    .foregroundStyle(entry.doneToday == entry.totalToday ? primaryAccent : .white.opacity(0.75))
            }
        }
    }
}

struct TaskLine: View {
    let task: TaskRow
    var showPages = true

    var body: some View {
        HStack(spacing: 7) {
            Circle()
                .fill(subjectColor(task.subject).opacity(task.completed ? 0.35 : 0.95))
                .frame(width: 5, height: 5)
            Text(task.title)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(.white.opacity(task.completed ? 0.35 : 0.88))
                .strikethrough(task.completed, color: .white.opacity(0.3))
                .lineLimit(1)
            Spacer(minLength: 4)
            if showPages, let pages = task.pages {
                Text(pages)
                    .font(.system(size: 8.5, weight: .medium).monospacedDigit())
                    .foregroundStyle(.white.opacity(task.completed ? 0.25 : 0.5))
                    .padding(.horizontal, 5).padding(.vertical, 1.5)
                    .background(Capsule().fill(.white.opacity(task.completed ? 0.04 : 0.07)))
            }
        }
    }
}

private let weekLetters = ["M", "T", "W", "T", "F", "S", "S"]

struct WeekStrip: View {
    let week: [DayMark]
    let todayIndex: Int
    var withLetters = true

    func dotColor(_ m: DayMark) -> Color {
        switch m {
        case .full:    return primaryAccent
        case .partial: return primaryAccent.opacity(0.4)
        case .missed:  return .white.opacity(0.16)
        case .none:    return .white.opacity(0.07)
        case .future:  return .white.opacity(0.05)
        }
    }

    var body: some View {
        HStack(spacing: 6) {
            ForEach(0..<7, id: \.self) { i in
                VStack(spacing: 2.5) {
                    if withLetters {
                        Text(weekLetters[i])
                            .font(.system(size: 7, weight: .medium))
                            .foregroundStyle(i == todayIndex ? primaryAccent : .white.opacity(0.3))
                    }
                    Circle()
                        .fill(dotColor(week[i]))
                        .frame(width: 5.5, height: 5.5)
                        .overlay {
                            if i == todayIndex {
                                Circle()
                                    .strokeBorder(primaryAccent.opacity(0.7), lineWidth: 1)
                                    .frame(width: 9.5, height: 9.5)
                            }
                        }
                        .frame(width: 9.5, height: 9.5)
                }
            }
        }
    }
}

struct CatchUpTag: View {
    let count: Int
    var body: some View {
        if count > 0 {
            Text("\(count) catch up")
                .font(.system(size: 8.5, weight: .semibold))
                .foregroundStyle(catchUpAccent.opacity(0.9))
                .padding(.horizontal, 6).padding(.vertical, 2)
                .background(Capsule().fill(catchUpAccent.opacity(0.12)))
        } else {
            Text("all caught up")
                .font(.system(size: 8.5, weight: .medium))
                .foregroundStyle(.white.opacity(0.35))
        }
    }
}

struct Hairline: View {
    var body: some View {
        Rectangle().fill(.white.opacity(0.08)).frame(height: 0.5)
    }
}

// MARK: - Widget views

struct SmallView: View {
    let entry: PlannerEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HeaderRow(entry: entry)
            Spacer(minLength: 5)
            if entry.tasks.isEmpty {
                Text(entry.isError ? "Loading plan…" : "Rest day")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.6))
                Spacer(minLength: 5)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(entry.tasks.prefix(3)) { t in
                        TaskLine(task: t, showPages: false)
                    }
                }
                Spacer(minLength: 6)
            }
            Hairline().padding(.bottom, 6)
            HStack {
                WeekStrip(week: entry.week, todayIndex: entry.todayIndex, withLetters: false)
                Spacer(minLength: 4)
                if entry.catchUp > 0 {
                    Text("\(entry.catchUp)")
                        .font(.system(size: 9, weight: .semibold).monospacedDigit())
                        .foregroundStyle(catchUpAccent.opacity(0.9))
                }
            }
        }
    }
}

struct MediumView: View {
    let entry: PlannerEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HeaderRow(entry: entry)
            Spacer(minLength: 6)
            if entry.tasks.isEmpty {
                Text(entry.isError ? "Loading plan — retrying shortly…" : "Rest day — nothing scheduled")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.6))
                Spacer(minLength: 6)
            } else {
                VStack(alignment: .leading, spacing: 6.5) {
                    ForEach(entry.tasks.prefix(3)) { t in
                        TaskLine(task: t)
                    }
                    if entry.tasks.count > 3 {
                        Text("+\(entry.tasks.count - 3) more")
                            .font(.system(size: 8.5, weight: .medium))
                            .foregroundStyle(.white.opacity(0.35))
                            .padding(.leading, 12)
                    }
                }
                Spacer(minLength: 7)
            }
            Hairline().padding(.bottom, 6)
            HStack(alignment: .center) {
                WeekStrip(week: entry.week, todayIndex: entry.todayIndex)
                Spacer()
                CatchUpTag(count: entry.catchUp)
            }
        }
    }
}

struct PlannerWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: PlannerEntry

    var body: some View {
        Group {
            switch family {
            case .systemMedium: MediumView(entry: entry)
            default: SmallView(entry: entry)
            }
        }
        .containerBackground(for: .widget) { appBackground }
    }
}

// MARK: - Widget

struct PlannerWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PlannerWidget", provider: Provider()) { entry in
            PlannerWidgetView(entry: entry)
        }
        .configurationDisplayName("Today's Plan")
        .description("Today's tasks, catch-up and weekly consistency.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

@main
struct PlannerWidgetBundle: WidgetBundle {
    var body: some Widget {
        PlannerWidget()
        PomodoroLiveActivity()
    }
}
