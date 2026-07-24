import Foundation

#if canImport(AppIntents)
import AppIntents
#endif

/// What a control on the Live Activity asks the session to do.
enum PomodoroAction: String {
    case pause, resume, restart, stop
}

/// Carries a control tap from the Live Activity into the running app.
///
/// `LiveActivityIntent.perform()` executes in the APP's process (waking it if
/// needed), so a plain NotificationCenter post reaches the Capacitor plugin.
/// The action is also queued in the app group, so a tap that arrives while the
/// web layer is asleep isn't lost — the plugin drains the queue on resume.
enum PomodoroControlBus {
    static let notification = Notification.Name("PomodoroControlAction")
    private static let suite = "group.com.kr1da.planner"
    private static let key = "pomodoroPendingActions"

    static func send(_ action: PomodoroAction) {
        let store = UserDefaults(suiteName: suite)
        var queue = store?.stringArray(forKey: key) ?? []
        queue.append(action.rawValue)
        // A backlog past a handful means nobody is draining it; keep it bounded.
        store?.set(Array(queue.suffix(8)), forKey: key)
        NotificationCenter.default.post(
            name: notification, object: nil, userInfo: ["action": action.rawValue]
        )
    }

    /// Returns and clears everything queued since the last drain.
    static func drain() -> [String] {
        let store = UserDefaults(suiteName: suite)
        let queue = store?.stringArray(forKey: key) ?? []
        store?.removeObject(forKey: key)
        return queue
    }

    /// Throw away anything queued. A session must never inherit a tap aimed at
    /// the previous one — that would open a fresh pomodoro already paused.
    static func clear() {
        UserDefaults(suiteName: suite)?.removeObject(forKey: key)
    }
}

#if canImport(AppIntents)
@available(iOS 17.0, *)
struct PomodoroControlIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Pomodoro Control"
    static var description = IntentDescription("Pause, restart or end the running focus session.")
    /// The controls only ever act on the session already on screen.
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Action")
    var action: String

    init() {}
    init(_ action: PomodoroAction) { self.action = action.rawValue }

    func perform() async throws -> some IntentResult {
        if let parsed = PomodoroAction(rawValue: action) {
            PomodoroControlBus.send(parsed)
        }
        return .result()
    }
}
#endif
